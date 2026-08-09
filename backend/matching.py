"""Wiring between the Flask app and sketch_matcher.

Two things this file exists to guarantee:

1. The model is built ONCE per process. Construction reads ~225 MB of weights;
   predict() is the cheap part. It is also built LAZILY, so the server still
   boots (and /api/health still answers) on a machine without torch installed
   or without the checkpoint present — only the ML endpoints fail, and they
   fail with a readable message instead of a stack trace at import time.

2. Vectors that are not comparable never get compared. sketch_matcher stamps
   every vector with model_version + classes_sha1, and temperature changes the
   vector's meaning without changing those stamps, so the temperature is
   checked here too.
"""
import json
import os
import sys
import threading
import uuid
from datetime import datetime

# sketch_matcher.py lives at the repo root, one level above backend/
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
CHECKPOINT = os.environ.get("SKETCH_CHECKPOINT", os.path.join(REPO_ROOT, "best.pt"))

# Cosine over a sharp 250-class softmax behaves almost like one-hot matching —
# same object ~1, different object ~0, nothing in between — so it needs softening.
# Measured on real vectors (stickman vs flower, i.e. two clearly different
# drawings): T=1.0 -> 0.02, T=1.5 -> 0.19, T=2.5 -> 0.72, T=4.0 -> 0.93.
# Past ~2 everything looks alike and both matching and rarity turn to mush.
# Re-index after changing this: POST /api/reindex.
TEMPERATURE = float(os.environ.get("SKETCH_TEMPERATURE", "1.5"))

# how close a drawing must sit to a group centroid to join it rather than found a new one
GROUP_THRESHOLD = float(os.environ.get("SKETCH_GROUP_THRESHOLD", "0.55"))

_classifier = None
_load_error = None
_lock = threading.Lock()


class ModelUnavailable(RuntimeError):
    """Raised when the checkpoint or torch is missing — surfaced as HTTP 503."""


def get_classifier():
    """Build on first use, then reuse. Thread-safe: Flask's dev server is threaded."""
    global _classifier, _load_error

    if _classifier is not None:
        return _classifier
    if _load_error is not None:
        raise ModelUnavailable(_load_error)

    with _lock:
        if _classifier is not None:
            return _classifier
        try:
            from sketch_matcher import SketchClassifier

            if not os.path.exists(CHECKPOINT):
                raise FileNotFoundError(
                    f"checkpoint not found at {CHECKPOINT}. "
                    "Set SKETCH_CHECKPOINT to its path."
                )
            _classifier = SketchClassifier(
                CHECKPOINT, images_dir=UPLOAD_FOLDER, temperature=TEMPERATURE
            )
            return _classifier
        except ImportError as exc:
            _load_error = (
                f"{exc}. Install the ML dependencies: "
                "pip install torch torchvision pillow numpy"
            )
        except Exception as exc:
            _load_error = f"{type(exc).__name__}: {exc}"

    raise ModelUnavailable(_load_error)


def model_status():
    """Never raises — for /api/model and health checks."""
    info = {
        "checkpoint": CHECKPOINT,
        "checkpoint_present": os.path.exists(CHECKPOINT),
        "temperature": TEMPERATURE,
        "group_threshold": GROUP_THRESHOLD,
        "loaded": _classifier is not None,
    }
    try:
        clf = get_classifier()
    except ModelUnavailable as exc:
        return {**info, "available": False, "error": str(exc)}

    return {
        **info,
        "available": True,
        "loaded": True,
        "classes": len(clf.classes),
        "classes_sha1": clf.classes_sha1,
        "img_size": clf.img_size,
        "device": str(clf.device),
        "metrics": clf.metrics,
    }


def classify_file(user_id, photo_filename):
    """Run inference for one user. Returns sketch_matcher's result dict.

    Note the key: our column is photo_filename, but sketch_matcher's payload
    contract is drawing_filename. Renaming it silently returns "missing
    drawing_filename" for every user.
    """
    clf = get_classifier()
    return clf.predict({"id": user_id, "drawing_filename": photo_filename})


def features_are_current(features):
    """A stored vector is stale if it came from another model, class ordering or
    temperature. Comparing across any of those returns plausible nonsense."""
    if not features or not features.get("similarity_vector"):
        return False
    try:
        clf = get_classifier()
    except ModelUnavailable:
        return True  # cannot verify; assume the caller knows what it stored

    return (
        features.get("classes_sha1") == clf.classes_sha1
        and features.get("temperature") == clf.temperature
    )


# ---------------------------------------------------------------------------
# groups — nearest centroid, created on demand
# ---------------------------------------------------------------------------

def assign_group(conn, user_id, features):
    """Put a drawing in the nearest group, or start a new one.

    sketch_matcher deliberately does not cluster (it never sees the whole corpus),
    so this is the online version: nearest centroid above a threshold, otherwise a
    new group named after the predicted class.
    """
    from sketch_matcher import assign_to_group, update_centroid

    vector = features.get("similarity_vector")
    if not vector:
        return None

    rows = conn.execute("SELECT id, centroid FROM groups").fetchall()
    centroids = {r["id"]: json.loads(r["centroid"]) for r in rows if r["centroid"]}

    verdict = assign_to_group(vector, centroids, threshold=GROUP_THRESHOLD)
    group_id = verdict.get("group")

    if group_id is None:
        group_id = uuid.uuid4().hex[:8]
        conn.execute(
            "INSERT INTO groups (id, label, centroid, size, model_version, "
            "classes_sha1, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                group_id,
                features.get("top_k", [{}])[0].get("class") if features.get("top_k") else None,
                json.dumps(vector),
                1,
                features.get("model_version"),
                features.get("classes_sha1"),
                datetime.now().isoformat(),
            ),
        )
    else:
        members = conn.execute(
            "SELECT drawing_features FROM users WHERE group_id = ? AND drawing_features IS NOT NULL",
            (group_id,),
        ).fetchall()

        vectors = []
        for row in members:
            stored = json.loads(row["drawing_features"] or "{}")
            if stored.get("similarity_vector"):
                vectors.append(stored["similarity_vector"])
        if vector not in vectors:
            vectors.append(vector)

        conn.execute(
            "UPDATE groups SET centroid = ?, size = ? WHERE id = ?",
            (json.dumps(update_centroid(vectors)), len(vectors), group_id),
        )

    conn.execute("UPDATE users SET group_id = ? WHERE id = ?", (group_id, user_id))
    return group_id


def row_to_profile(row):
    """DB row -> the dict shape rank_matches expects."""
    return {
        "id": row["id"],
        "age": row["age"],
        "gender": row["gender"],
        "interested_in": (row["interested_in"] or "").split(",") if row["interested_in"] else [],
        "class": row["drawing_class"],
        "features": json.loads(row["drawing_features"] or "{}") or None,
    }
