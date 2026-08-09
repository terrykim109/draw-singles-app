"""Runnable example: single user, batch, ranking, and threshold calibration."""
import json
from sketch_matcher import (SketchClassifier, cosine_similarity, is_eligible,
                            rank_matches, similarity_report, update_centroid,
                            assign_to_group)

CKPT = "runs/resnet152_tuberlin/resnet152_tuberlin_final.pt"
UPLOADS = "uploads"

# Build ONCE per process (reads ~230 MB of weights). Reuse for every request.
clf = SketchClassifier(CKPT, images_dir=UPLOADS, temperature=1.0)

# ---- 1. single user -------------------------------------------------------
payload = {
    "id": "abc123",
    "age": 23,
    "gender": "male",
    "interested_in": ["female"],
    "drawing_filename": "abc123_drawing.jpg",
}
result = clf.predict(payload)
print(json.dumps({k: v for k, v in result.items() if k != "features"}, indent=2))
print("vector_dim:", result["features"]["vector_dim"])
print("top_k:", result["features"]["top_k"][:3])

# Persist result["features"]["similarity_vector"] (250 floats) next to the user,
# together with model_version + classes_sha1. Also persist "logits": from logits you
# can recompute the vector at ANY temperature later without re-running the model.

# ---- 2. batch backfill ---------------------------------------------------
users = [payload,
         {"id": "u2", "age": 25, "gender": "female", "interested_in": ["male"],
          "drawing_filename": "u2_drawing.jpg"},
         {"id": "u4", "age": 31, "gender": "female", "interested_in": ["male"],
          "drawing_filename": "u4_drawing.png"}]
records = [{**u, **clf.predict(u)} for u in users]
ok = [r for r in records if r["status"] == "ok"]
print(f"\nindexed {len(ok)}/{len(records)}")

# ---- 3. ranking (orientation is a hard gate, applied before scoring) ------
matches = rank_matches(ok[0], ok[1:], min_similarity=0.0, limit=10)
print("matches:", matches)

# ---- 4. calibrate your threshold on YOUR data, do not guess it ------------
if len(ok) >= 2:
    print("\nsimilarity distribution:",
          json.dumps(similarity_report([r["features"]["similarity_vector"] for r in ok]),
                     indent=2))
