# Sketch Matcher

Classifies a hand-drawn sketch into one of **250 object categories** and emits a 250-dimensional
embedding used to group users by what they drew.

The backbone is **ResNet-152** (He et al., 2016), initialised from torchvision's ImageNet weights
(`ResNet152_Weights.IMAGENET1K_V1`) and fine-tuned on the **TU-Berlin human sketch dataset**
(Eitz, Hays & Alexa, 2012). Full citations in [Credits](#credits).

## Contents

```
sketch_matcher.py    the module — inference, preprocessing, cosine matching
example_usage.py     runnable example: single user, batch backfill, ranking, calibration
```

`sketch_matcher.py` has no internal dependencies. Drop it anywhere on your `sys.path`.

## Requirements

```bash
pip install torch torchvision pillow numpy
```

Plus a trained checkpoint (`best.pt`). The model is built with `weights=None` and every parameter
comes from that file, so **nothing is downloaded at runtime** — the module works fully offline.
A GPU is used when available; CPU is fine for low request volumes.

## Quickstart

```python
from sketch_matcher import SketchClassifier, rank_matches

# Build ONCE per process — this reads ~230 MB of weights. predict() is the cheap part.
clf = SketchClassifier(
    "runs/resnet152_tuberlin/best.pt",
    images_dir="/var/app/uploads",
    temperature=1.0,
)

result = clf.predict({
    "id": "abc123",
    "age": 23,
    "gender": "male",
    "interested_in": ["female"],
    "drawing_filename": "abc123_drawing.jpg",
})
```

`drawing_filename` resolves relative to `images_dir`; absolute paths are used as given.
See `example_usage.py` for batch backfill and ranking.

### Response

```json
{
  "id": "abc123",
  "status": "ok",
  "class": "cat",
  "confidence": 0.412,
  "features": {
    "similarity_vector": [250 floats, L2-normalised],
    "logits": [250 floats],
    "top_k": [{"class": "cat", "p": 0.412}, "..."],
    "quality": {
      "blank": false, "entropy": 2.91, "max_entropy": 5.52,
      "margin": 0.287, "low_confidence": false,
      "stroke_density": 0.041, "preprocess_notes": ["levels_stretched", "autocropped"]
    },
    "model_version": "resnet152-tuberlin-v1",
    "classes_sha1": "4a67c317777e",
    "vector_dim": 250,
    "vector_kind": "class_probabilities_l2",
    "temperature": 1.0
  }
}
```

`status` is `ok`, `rejected` (blank or unusable upload) or `error` (missing/corrupt file).
`predict()` never raises on bad user input, so one bad upload cannot kill a batch job.

## API

| Function | Purpose |
|---|---|
| `SketchClassifier(checkpoint, images_dir, temperature, top_k, ...)` | Load once, reuse per request |
| `.predict(payload)` | One profile → the response above |
| `.predict_batch(payloads)` | List of responses |
| `cosine_similarity(a, b)` | Similarity between two stored vectors |
| `is_eligible(a, b)` | Mutual orientation gate |
| `rank_matches(query, candidates, ...)` | Gate by eligibility, then rank by similarity |
| `assign_to_group(vector, centroids, threshold)` | Nearest-centroid group assignment |
| `update_centroid(vectors)` | Re-normalised mean of member vectors |
| `similarity_report(vectors)` | Pairwise-similarity percentiles, for threshold calibration |
| `assert_comparable(a, b)` | Raise if two vectors come from different model versions |

## Model

| | |
|---|---|
| Architecture | ResNet-152, 58.7M parameters with the 250-class head, 2048-d penultimate features |
| Initialisation | torchvision `IMAGENET1K_V1` |
| Head | `Dropout(0.2) → Linear(2048, 250)` |
| Input | 224×224, grayscale replicated to 3 channels, ImageNet normalisation |
| Training | Stage 1 head-only, 3 epochs, LR 1e-3 (0.51M trainable). Stage 2 full fine-tune, 15 epochs, discriminative LRs (backbone 1e-4, head 5e-4), AdamW, weight decay 1e-4, cosine schedule with warmup, label smoothing 0.1, FP16 AMP, batch size 32 |
| Data | 20,000 PNGs at native 1111×1111, 250 classes, exactly 80 per class; cached at 256px, trained at 224px |

### Data and splits

Source: the three parquet shards from the Hugging Face mirror
[`sdiaeyu6n/tu-berlin`](https://huggingface.co/datasets/sdiaeyu6n/tu-berlin), downloaded by hand.
Class names were recovered from the parquet schema metadata, giving the original TU-Berlin labels
(`airplane`, `alarm clock`, …) rather than numeric indices.

**All three of the mirror's shards were merged and re-split.** The mirror's own split is random,
not stratified, so it was discarded:

| | Mirror's split | Split actually used |
|---|---|---|
| Train | 16,000 | 16,000 — exactly 64 per class |
| Validation | 2,000 | 2,000 — exactly 8 per class |
| Test | 2,000 | 2,000 — exactly 8 per class |
| Stratified | no | yes |
| Seed | unknown | 42 |

> ⚠️ The totals are identical in both columns, which makes it easy to assume the mirror's split was
> used. It was not. The two splits partition the same 20,000 images differently — only the right-hand
> one guarantees every class is evenly represented in every split.

Verified properties of the split used:

- **No leakage.** Zero overlap between train/val, train/test and val/test.
- **Nothing duplicated by the merge.** After merging all three shards the dataset holds exactly
  20,000 images with exactly 80 per class — identical to the original dataset — so the mirror's
  shards contained no overlapping images.
- **Reproducible.** `np.random.default_rng(42)` per class, so re-running the split cell rebuilds the
  identical test set. Changing the seed to 43 shares only 206 of 2,000 test images, so any accuracy
  quoted here is tied to seed 42.

## Results

Held-out test split: 2,000 sketches, exactly 8 per class × 250 classes, stratified, seed 42
(see [Data and splits](#data-and-splits)):

| Metric | |
|---|---|
| **Top-1 accuracy** | **83.55%** (95% CI 81.86–85.11%) |
| **Top-5 accuracy** | **95.85%** |
| Test loss | 1.5332 |
| Human baseline (Eitz et al. 2012) | 73% |

Notes on reading these numbers honestly:

- **The confidence interval is not decoration.** With n = 2,000 the 95% Wilson interval is ±1.6pp, so
  83.55% and, say, 82.5% are not distinguishable results. The checkpoint's own stored `val_top1` is
  82.45% — the 1.1pp gap to test is well inside the interval and means nothing.
- **`best.pt` stores `val_top1`, which is a model-selection score**, not a held-out estimate: that
  epoch was chosen *because* it maximised validation accuracy. Quote the test figures above instead.
  `clf.metrics` surfaces whichever field the checkpoint carries, so it will show `val_top1` here.
- **Loss 1.5332 is not as high as it looks.** Label smoothing at ε = 0.1 over K = 250 classes puts an
  irreducible floor of **0.8737** on cross-entropy — a perfect model cannot score below it, because
  the targets are not one-hot. The run therefore sits 0.66 above the achievable floor, not 1.53.
- **Not comparable to published leaderboards.** Most TU-Berlin results use 3-fold cross-validation;
  this is a single hold-out split (train 16,000 / val 2,000 / test 2,000).
- **Above the human baseline, but across protocols.** The 73% figure comes from the paper's own
  perceptual study, not from this split, so treat it as a reference point rather than a head-to-head.
- **The model memorised the training set.** Final training top-1 was 99.36% against 83.55% on test —
  a ~16pp generalisation gap, with training loss (1.0012) almost at the smoothing floor. More epochs
  will not help; the remaining headroom is in regularisation, augmentation strength, and input
  resolution, not schedule length. Validation top-1 had also flattened by epoch 12 of 15.
- **Per-class accuracies are extremely noisy.** Each class has only 8 test images, so per-class
  figures move in 12.5pp steps — a class reported at 12% got 1 of 8 right, and a class at 100% got
  8 of 8. Do not rank categories off those numbers.

## Similarity & matching

The embedding is the **250-dim class-probability distribution**, L2-normalised — so a plain dot
product between two stored vectors *is* their cosine similarity, and it always falls in `[0, 1]`
because probabilities are non-negative.

```python
matches = rank_matches(query_record, candidate_records, min_similarity=0.2, limit=20)
```

`rank_matches` applies mutual orientation eligibility as a **hard gate before scoring**. Never fold
`gender` or `interested_in` into the similarity metric — doing so ranks people by how *similar*
their orientation is instead of respecting it. No age rule is applied; add yours in `is_eligible`.

### Temperature — read this before choosing a threshold

Cosine over a sharp 250-class softmax behaves close to one-hot matching. Measured on simulated
distributions from a plausibly-trained model:

| Temperature | median pairwise cosine | pairs below 0.05 |
|---|---|---|
| 1.0 | 0.011 | 91% |
| 2.0 | 0.409 | 0% |
| 3.0 | 0.786 | 1% |

At `T=1.0` two users who drew the same object score ~1 and everyone else ~0, with little in between —
groups become literally "people who drew a cat". `T≈1.5–2.5` gives a graded signal. Above 3 it
saturates and stops discriminating.

Those figures come from simulated distributions, not real users. Run `similarity_report(vectors)`
over your own corpus and read the percentiles before fixing a threshold.

**Persist `logits` alongside the vector.** From logits you can rebuild the embedding at any
temperature without a second forward pass — otherwise changing `T` means re-running the model over
every user.

### Version stamping

Vectors are comparable only when the model *and* the class ordering match. Every response carries
`model_version` and `classes_sha1`; `assert_comparable(a, b)` raises rather than silently returning
plausible-looking nonsense.

## Preprocessing

Uploads are normalised toward the training distribution: alpha flattened onto white, grayscale,
auto-inversion when the background reads dark, level stretch so paper becomes true white, autocrop
to the drawing plus a 10% margin, pad to square, then the same resize/centre-crop used at eval time.
Optional Otsu binarisation and stroke thickening for photographed pencil drawings, via
`PreprocessConfig`. Every step actually applied is reported in `quality.preprocess_notes`.

Inference is deterministic: eval mode, no test-time augmentation, float32, cuDNN autotuning off.
Repeated calls give bit-identical vectors on the same device. Build your whole index on one device
type — GPU and CPU differ in the last few decimals.

## Known limitations

- **250 fixed categories, no abstain.** Softmax always sums to 1, so an out-of-vocabulary drawing
  gets a confident wrong answer by construction. Gate on `quality.low_confidence`.
- **Confidence is not calibrated.** Label smoothing capped training targets at 0.9, so outputs are
  mechanically less peaked. Treat values as relative scores; a reliability diagram over a held-out
  set is needed to say anything real about calibration.
- **Genuinely ambiguous categories.** table/bench, monitor/tv and similar pairs are hard for humans
  too.
- **`assign_to_group` is nearest-centroid with a threshold**, not real clustering. Proper clustering
  needs the whole corpus, which this module never sees.
- **224px throws away stroke detail.** Higher input resolution is the biggest available accuracy
  lever if you retrain.

## Credits

### Dataset

Eitz, M., Hays, J., & Alexa, M. (2012). How Do Humans Sketch Objects?
*ACM Transactions on Graphics (Proc. SIGGRAPH)*, 31(4), Article 44, 44:1–44:10.
DOI: [10.1145/2185520.2185540](https://doi.org/10.1145/2185520.2185540)

```bibtex
@article{eitz2012hdhso,
  author  = {Eitz, Mathias and Hays, James and Alexa, Marc},
  title   = {How Do Humans Sketch Objects?},
  journal = {ACM Trans. Graph. (Proc. SIGGRAPH)},
  year    = {2012},
  volume  = {31},
  number  = {4},
  pages   = {44:1--44:10},
  doi     = {10.1145/2185520.2185540}
}
```

The TU-Berlin sketch dataset (20,000 sketches, 250 categories, 80 per category) is distributed under
a **Creative Commons Attribution 4.0 International (CC BY 4.0)** license, which requires attribution
in any derivative work — including a model fine-tuned on it. Keep this section intact when
redistributing this code or the checkpoint.

### Architecture

He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep Residual Learning for Image Recognition.
*Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)*, 770–778.
DOI: [10.1109/CVPR.2016.90](https://doi.org/10.1109/CVPR.2016.90) ·
arXiv: [1512.03385](https://arxiv.org/abs/1512.03385)

```bibtex
@inproceedings{he2016resnet,
  author    = {He, Kaiming and Zhang, Xiangyu and Ren, Shaoqing and Sun, Jian},
  title     = {Deep Residual Learning for Image Recognition},
  booktitle = {Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)},
  year      = {2016},
  pages     = {770--778},
  doi       = {10.1109/CVPR.2016.90}
}
```

### Pretrained weights

ImageNet-1k weights via `torchvision.models.resnet152(weights=ResNet152_Weights.IMAGENET1K_V1)`.

### Implementation

Developed with **Claude (Anthropic)** in an interactive session, August 2026. Claude wrote the
fine-tuning pipeline, the preprocessing and inference code in `sketch_matcher.py`, the
similarity/matching design, and this README. The training run, the resulting checkpoint, and every
accuracy figure reported above are the author's own.

What was and was not verified, so nobody has to guess:

- `sketch_matcher.py` was exercised end to end against a synthetic checkpoint using the same schema
  as `best.pt` — response shape, JSON-serialisability, L2 norm of the vector, determinism across
  repeated calls, the three failure paths, the eligibility gate, and version stamping.
- The preprocessing pipeline was tested on synthetic inputs covering clean digital line art,
  photographed grey paper, thin pencil at 3000px, white-on-black, transparent PNG, a drawing jammed
  into the frame corner, and a blank image.
- The split properties in [Data and splits](#data-and-splits) were re-derived independently from the
  split code, not read off the training log.
- **Not** formally audited, and never run against the real checkpoint on the author's data by Claude.
  Numbers in this README that came from the training run were supplied by the author.

If this work goes into a paper, thesis or grant report, check the venue's AI-disclosure policy —
several now require a specific statement about tool-assisted code and writing.
