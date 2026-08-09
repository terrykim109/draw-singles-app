"""
sketch_matcher - importable inference + similarity module for the fine-tuned
ResNet-152 TU-Berlin sketch classifier.

Typical backend usage
---------------------
    from sketch_matcher import SketchClassifier, cosine_similarity, rank_matches

    clf = SketchClassifier("runs/resnet152_tuberlin/resnet152_tuberlin_final.pt",
                           images_dir="/var/app/uploads")

    result = clf.predict({
        "id": "abc123",
        "age": 23,
        "gender": "male",
        "interested_in": ["female"],
        "drawing_filename": "abc123_drawing.jpg",
    })
    # -> {"id": ..., "status": "ok", "class": ..., "confidence": ..., "features": {...}}

Load the model ONCE at process start. Construction reads ~230 MB of weights;
predict() is the cheap part.

Design notes that matter for correctness
----------------------------------------
* The similarity vector is the 250-dim class-probability distribution, L2-normalised,
  so a plain dot product between two stored vectors IS their cosine similarity.
* Vectors are only comparable when they come from the same model AND the same class
  ordering. Both are stamped into every response (`model_version`, `classes_sha1`).
  Refuse to compare vectors whose stamps differ - see `assert_comparable`.
* Inference is deterministic: eval mode, no test-time augmentation, float32 (no AMP),
  cudnn autotuning off. Repeated calls on the same file give bit-identical vectors on
  the same device. Across devices (GPU vs CPU) expect drift in the last few decimals,
  so build your whole index on one device type.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageFilter, ImageOps
from torchvision import transforms
from torchvision.models import resnet152

__all__ = [
    "SketchClassifier",
    "PreprocessConfig",
    "cosine_similarity",
    "is_eligible",
    "rank_matches",
    "assign_to_group",
    "similarity_report",
    "assert_comparable",
    "MODEL_VERSION",
]

MODEL_VERSION = "resnet152-tuberlin-v1"
PREPROCESS_VERSION = "prep-v1"

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
IMG_EXTS = (".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff")

# interested_in values meaning "no restriction"
_WILDCARDS = {"any", "all", "anyone", "everyone", "*"}


# ---------------------------------------------------------------------------
# preprocessing
# ---------------------------------------------------------------------------

@dataclass
class PreprocessConfig:
    """Normalises an arbitrary upload toward the training distribution:
    1111x1111, black strokes on white, object filling the canvas."""
    auto_levels: bool = True   # stretch grey paper to true white
    autocrop: bool = True      # crop to the drawing, re-pad with a margin
    margin_frac: float = 0.10  # white margin kept after autocrop
    binarize: bool = False     # Otsu; enable for low-contrast photos
    thicken: int = 0           # 0 off, else 3/5: widen strokes before downscaling
    min_ink_pixels: int = 40   # below this the upload is rejected as blank


def _otsu_threshold(a: np.ndarray) -> int:
    hist = np.bincount(a.ravel(), minlength=256).astype(float)
    total = hist.sum()
    omega = np.cumsum(hist) / total
    mu = np.cumsum(hist * np.arange(256)) / total
    mu_t = mu[-1]
    denom = omega * (1.0 - omega)
    denom[denom == 0] = 1e-12
    return int(np.argmax((mu_t * omega - mu) ** 2 / denom))


def _normalize_base(im: Image.Image) -> tuple[Image.Image, list[str]]:
    """Flatten alpha, grayscale, orient to black-on-white."""
    notes: list[str] = []

    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
        notes.append("alpha_flattened")

    im = im.convert("L")
    a = np.asarray(im)

    h, w = a.shape
    k = max(4, min(h, w) // 20)
    corners = np.concatenate([a[:k, :k].ravel(), a[:k, -k:].ravel(),
                              a[-k:, :k].ravel(), a[-k:, -k:].ravel()])
    if np.median(corners) < 128:
        im = ImageOps.invert(im)
        notes.append("inverted")

    return im, notes


def preprocess(im: Image.Image, cfg: PreprocessConfig) -> tuple[Image.Image, dict]:
    """Returns the square black-on-white image plus quality metadata."""
    im, notes = _normalize_base(im)
    a = np.asarray(im)

    paper = float(np.percentile(a, 95))
    ink_mask = a < (paper - 40)
    ink_pixels = int(ink_mask.sum())

    meta: dict[str, Any] = {
        "notes": notes,
        "paper_level": round(paper, 1),
        "ink_pixels": ink_pixels,
        "source_size": list(im.size),
        "blank": ink_pixels < cfg.min_ink_pixels,
    }
    if meta["blank"]:
        return im, meta

    # dark end must be measured over ink only: on a photo where strokes are a fraction
    # of a percent of the frame, even the 1st percentile of the image is still paper
    if cfg.auto_levels:
        lo = float(np.percentile(a[ink_mask], 5))
        if paper - lo > 20 and (paper < 250 or lo > 8):
            a = np.clip((a.astype(np.float32) - lo) * (255.0 / (paper - lo)),
                        0, 255).astype(np.uint8)
            im = Image.fromarray(a)
            notes.append("levels_stretched")

    if cfg.thicken and cfg.thicken >= 3:
        im = im.filter(ImageFilter.MinFilter(int(cfg.thicken)))
        a = np.asarray(im)
        notes.append("thickened")

    if cfg.binarize:
        t = _otsu_threshold(a)
        a = np.where(a > t, 255, 0).astype(np.uint8)
        im = Image.fromarray(a)
        notes.append("binarized")

    if cfg.autocrop:
        paper2 = float(np.percentile(a, 95))
        ink2 = a < (paper2 - 40)
        if ink2.any():
            ys, xs = np.where(ink2)
            y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
            side = int(max(y1 - y0, x1 - x0)) + 1
            half = side // 2 + int(round(side * cfg.margin_frac))
            cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
            canvas = Image.new("L", (2 * half, 2 * half), color=255)
            # clamp to the real image: a crop past the edge is filled with BLACK by
            # PIL, which the network would read as strokes that are not there
            sx0, sy0 = max(0, cx - half), max(0, cy - half)
            sx1, sy1 = min(im.width, cx + half), min(im.height, cy + half)
            canvas.paste(im.crop((sx0, sy0, sx1, sy1)),
                         (sx0 - (cx - half), sy0 - (cy - half)))
            im = canvas
            meta["drawing_side_px"] = side
            meta["stroke_density"] = round(float(ink2.sum()) / float(side ** 2), 4)
            notes.append("autocropped")

    w, h = im.size
    if w != h:
        side = max(w, h)
        canvas = Image.new("L", (side, side), color=255)
        canvas.paste(im, ((side - w) // 2, (side - h) // 2))
        im = canvas
        notes.append("padded_square")

    return im, meta


# ---------------------------------------------------------------------------
# classifier
# ---------------------------------------------------------------------------

class SketchClassifier:
    def __init__(
        self,
        checkpoint_path: str | Path,
        images_dir: str | Path = ".",
        device: str | torch.device | None = None,
        temperature: float = 1.0,
        top_k: int = 8,
        low_confidence_threshold: float = 0.15,
        preprocess_config: PreprocessConfig | None = None,
    ):
        self.checkpoint_path = Path(checkpoint_path)
        self.images_dir = Path(images_dir)
        self.temperature = float(temperature)
        self.top_k = int(top_k)
        self.low_confidence_threshold = float(low_confidence_threshold)
        self.cfg = preprocess_config or PreprocessConfig()

        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = torch.device(device)

        torch.backends.cudnn.benchmark = False  # stable algorithm choice

        self.model, self.classes, self.img_size, self.metrics = self._load()
        self.classes_sha1 = hashlib.sha1(
            "\n".join(self.classes).encode("utf-8")
        ).hexdigest()[:12]

        self.eval_tf = transforms.Compose([
            transforms.Resize(int(round(self.img_size * 1.14))),
            transforms.CenterCrop(self.img_size),
            transforms.Grayscale(num_output_channels=3),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ])

    # -- loading ------------------------------------------------------------

    def _load(self):
        if not self.checkpoint_path.exists():
            raise FileNotFoundError(f"checkpoint not found: {self.checkpoint_path}")
        try:
            ck = torch.load(self.checkpoint_path, map_location="cpu", weights_only=True)
        except Exception:
            ck = torch.load(self.checkpoint_path, map_location="cpu", weights_only=False)

        sd = ck.get("state_dict") or ck.get("model")
        if sd is None:
            raise KeyError(f"no weights in checkpoint; keys={list(ck.keys())}")

        classes = [str(c) for c in ck["classes"]]
        img_size = int(ck.get("img_size", 224))

        # rebuild the head with the same module structure the weights came from,
        # or strict load fails on key names
        if "fc.1.weight" in sd:
            n_out, n_in = sd["fc.1.weight"].shape
            head: nn.Module = nn.Sequential(nn.Dropout(0.0), nn.Linear(n_in, n_out))
        elif "fc.weight" in sd:
            n_out, n_in = sd["fc.weight"].shape
            head = nn.Linear(n_in, n_out)
        else:
            raise KeyError("no classifier head found in checkpoint")

        if n_out != len(classes):
            raise ValueError(f"head outputs {n_out} but got {len(classes)} class names")

        model = resnet152(weights=None)  # nothing downloaded
        model.fc = head
        model.load_state_dict(sd, strict=True)
        model.eval().to(self.device)
        for p in model.parameters():
            p.requires_grad_(False)

        metrics = {k: float(ck[k]) for k in ("test_top1", "test_top5", "val_top1")
                   if k in ck}
        return model, classes, img_size, metrics

    # -- core ---------------------------------------------------------------

    @torch.no_grad()
    def _logits(self, pil_img: Image.Image) -> np.ndarray:
        """float32, no AMP, no TTA -> deterministic."""
        x = self.eval_tf(pil_img).unsqueeze(0).to(self.device, dtype=torch.float32)
        return self.model(x)[0].float().cpu().numpy()

    def _similarity_vector(self, logits: np.ndarray) -> np.ndarray:
        """Temperature softmax, then L2-normalise so dot product == cosine."""
        z = logits.astype(np.float64) / max(self.temperature, 1e-6)
        z -= z.max()
        p = np.exp(z)
        p /= p.sum()
        n = np.linalg.norm(p)
        return (p / n if n > 0 else p).astype(np.float32)

    def resolve_path(self, filename: str) -> Path:
        p = Path(filename)
        return p if p.is_absolute() else self.images_dir / p

    # -- public API ---------------------------------------------------------

    def predict(self, payload: dict) -> dict:
        """payload: {"id", "age", "gender", "interested_in", "drawing_filename"}

        Always returns a dict. `status` is "ok", "rejected" (unusable upload) or
        "error" (missing/corrupt file). Never raises on bad user input, so a single
        bad upload cannot take down a batch job.
        """
        uid = payload.get("id")
        filename = payload.get("drawing_filename")

        base = {
            "id": uid,
            "class": None,
            "confidence": None,
            "features": None,
        }

        if not filename:
            return {**base, "status": "error", "reason": "missing drawing_filename"}

        path = self.resolve_path(filename)
        if not path.exists():
            return {**base, "status": "error", "reason": f"file not found: {path}"}

        try:
            with Image.open(path) as raw:
                raw.load()
                img, meta = preprocess(raw, self.cfg)
        except Exception as e:
            return {**base, "status": "error",
                    "reason": f"unreadable image: {type(e).__name__}: {e}"}

        if meta.get("blank"):
            return {**base, "status": "rejected", "reason": "blank_or_no_ink",
                    "features": {"quality": self._quality(meta, None)}}

        logits = self._logits(img)
        vec = self._similarity_vector(logits)

        # probabilities at T=1 are what "confidence" should report, regardless of
        # the temperature used to build the similarity vector
        z = logits.astype(np.float64) - logits.max()
        probs = np.exp(z)
        probs /= probs.sum()

        order = np.argsort(probs)[::-1]
        top = [{"class": self.classes[i], "p": round(float(probs[i]), 6)}
               for i in order[:self.top_k]]

        return {
            "id": uid,
            "status": "ok",
            "class": self.classes[int(order[0])],
            "confidence": round(float(probs[order[0]]), 6),
            "features": {
                "similarity_vector": [round(float(v), 6) for v in vec],
                "logits": [round(float(v), 4) for v in logits],
                "top_k": top,
                "quality": self._quality(meta, probs),
                "model_version": MODEL_VERSION,
                "preprocess_version": PREPROCESS_VERSION,
                "classes_sha1": self.classes_sha1,
                "vector_dim": int(vec.size),
                "vector_kind": "class_probabilities_l2",
                "temperature": self.temperature,
            },
        }

    def _quality(self, meta: dict, probs: np.ndarray | None) -> dict:
        q: dict[str, Any] = {
            "blank": bool(meta.get("blank", False)),
            "preprocess_notes": meta.get("notes", []),
            "paper_level": meta.get("paper_level"),
            "ink_pixels": meta.get("ink_pixels"),
            "stroke_density": meta.get("stroke_density"),
            "source_size": meta.get("source_size"),
        }
        if probs is not None:
            s = np.sort(probs)[::-1]
            ent = max(0.0, float(-(probs * np.log(probs + 1e-12)).sum()))
            q.update({
                "entropy": round(ent, 4),
                "max_entropy": round(float(np.log(len(probs))), 4),
                "margin": round(float(s[0] - s[1]), 6),
                "low_confidence": bool(s[0] < self.low_confidence_threshold),
            })
        return q

    def predict_batch(self, payloads: Iterable[dict]) -> list[dict]:
        return [self.predict(p) for p in payloads]


# ---------------------------------------------------------------------------
# similarity / matching
# ---------------------------------------------------------------------------

def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity. Vectors from `predict` are already L2-normalised, so this
    reduces to a dot product, but it re-normalises defensively in case a caller
    passes raw probabilities."""
    va = np.asarray(a, dtype=np.float64)
    vb = np.asarray(b, dtype=np.float64)
    if va.shape != vb.shape:
        raise ValueError(f"dimension mismatch: {va.shape} vs {vb.shape}")
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.clip(np.dot(va, vb) / (na * nb), -1.0, 1.0))


def assert_comparable(fa: dict, fb: dict) -> None:
    """Two vectors are only comparable if model AND class ordering match. Comparing
    across versions silently returns plausible-looking nonsense, so fail loudly."""
    for key in ("model_version", "classes_sha1", "vector_kind"):
        if fa.get(key) != fb.get(key):
            raise ValueError(
                f"incomparable vectors: {key} differs ({fa.get(key)!r} vs {fb.get(key)!r}). "
                "Re-run inference on both before comparing."
            )


def _norm_set(values) -> set[str]:
    if values is None:
        return set()
    if isinstance(values, str):
        values = [values]
    return {str(v).strip().lower() for v in values if str(v).strip()}


def is_eligible(a: dict, b: dict) -> bool:
    """Mutual orientation filter. This is a HARD gate applied before ranking - never
    fold gender or interested_in into the similarity metric, or the system starts
    matching people by how similar their orientation is instead of respecting it.

    No age rule is applied: you have not specified one. Add it here if you want it.
    """
    a_wants, b_wants = _norm_set(a.get("interested_in")), _norm_set(b.get("interested_in"))
    a_is = str(a.get("gender", "")).strip().lower()
    b_is = str(b.get("gender", "")).strip().lower()

    a_ok = (not a_wants) or bool(a_wants & _WILDCARDS) or (b_is in a_wants)
    b_ok = (not b_wants) or bool(b_wants & _WILDCARDS) or (a_is in b_wants)
    return a_ok and b_ok


def rank_matches(
    query: dict,
    candidates: Iterable[dict],
    min_similarity: float = 0.0,
    limit: int | None = None,
    check_versions: bool = True,
) -> list[dict]:
    """Filter by mutual eligibility, then rank by cosine similarity of the drawing.

    `query` and each candidate: a profile dict merged with its `predict` result, i.e.
    carrying at least id, gender, interested_in and features.similarity_vector.
    """
    qf = query.get("features") or {}
    qv = qf.get("similarity_vector")
    if not qv:
        raise ValueError("query has no features.similarity_vector")

    out = []
    for c in candidates:
        if c.get("id") == query.get("id"):
            continue
        cf = c.get("features") or {}
        cv = cf.get("similarity_vector")
        if not cv:
            continue
        if not is_eligible(query, c):
            continue
        if check_versions:
            assert_comparable(qf, cf)
        s = cosine_similarity(qv, cv)
        if s >= min_similarity:
            out.append({"id": c.get("id"), "similarity": round(s, 6),
                        "class": c.get("class")})

    out.sort(key=lambda r: r["similarity"], reverse=True)
    return out[:limit] if limit else out


def assign_to_group(
    vector: Sequence[float],
    groups: dict[str, Sequence[float]],
    threshold: float = 0.5,
) -> dict:
    """Nearest-centroid assignment against existing group centroids.

    Returns the best group, or group=None when nothing clears `threshold` so the
    caller can open a new group. Centroids must be L2-normalised - use
    `update_centroid`. This is deliberately simple: real clustering needs the whole
    corpus, which this module never sees.
    """
    best, best_s = None, -1.0
    scores = {}
    for gid, centroid in groups.items():
        s = cosine_similarity(vector, centroid)
        scores[gid] = round(s, 6)
        if s > best_s:
            best, best_s = gid, s
    if best_s < threshold:
        return {"group": None, "similarity": round(best_s, 6) if groups else None,
                "scores": scores, "reason": "below_threshold"}
    return {"group": best, "similarity": round(best_s, 6), "scores": scores}


def update_centroid(vectors: Sequence[Sequence[float]]) -> list[float]:
    """Mean of member vectors, re-normalised. The mean of unit vectors is not itself
    a unit vector, so skipping the re-normalisation biases every later cosine."""
    m = np.asarray(vectors, dtype=np.float64).mean(axis=0)
    n = np.linalg.norm(m)
    return [float(v) for v in (m / n if n > 0 else m)]


def similarity_report(vectors: Sequence[Sequence[float]], sample: int = 2000) -> dict:
    """Distribution of pairwise cosine similarities over your OWN users.

    Read this before trusting a threshold. Cosine over a sharp 250-class softmax is
    close to one-hot matching: two users who drew the same object score near 1, two
    who drew different objects score near 0, and there is little in between. If this
    report shows most pairs near 0 and you want a smoother signal, raise the
    classifier's `temperature` (2-4) and re-index - that softens the distributions so
    semantically near classes retain some overlap.
    """
    V = np.asarray(vectors, dtype=np.float64)
    if V.ndim != 2 or V.shape[0] < 2:
        raise ValueError("need at least 2 vectors")
    V = V / np.clip(np.linalg.norm(V, axis=1, keepdims=True), 1e-12, None)

    n = V.shape[0]
    rng = np.random.default_rng(0)
    if n > sample:
        V = V[rng.choice(n, sample, replace=False)]
    S = V @ V.T
    iu = np.triu_indices(V.shape[0], k=1)
    s = S[iu]
    qs = np.percentile(s, [5, 25, 50, 75, 95, 99])
    return {
        "pairs": int(s.size),
        "mean": round(float(s.mean()), 4),
        "std": round(float(s.std()), 4),
        "p05": round(float(qs[0]), 4),
        "p25": round(float(qs[1]), 4),
        "median": round(float(qs[2]), 4),
        "p75": round(float(qs[3]), 4),
        "p95": round(float(qs[4]), 4),
        "p99": round(float(qs[5]), 4),
        "frac_below_0.05": round(float((s < 0.05).mean()), 4),
        "frac_above_0.90": round(float((s > 0.90).mean()), 4),
    }
