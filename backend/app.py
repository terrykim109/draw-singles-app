from unittest import result

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import uuid
import os
import json
import re
import base64
import atexit
import subprocess
import threading
import sys
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
from db import init_db, get_db
from matching import (
    ModelUnavailable,
    assign_group,
    classify_file,
    features_are_current,
    get_classifier,
    model_status,
    row_to_profile,
)

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

init_db()


def save_base64_image(data_url):
    """Decode base64 data URL and save to uploads/. Returns filename or None."""
    if not data_url or not data_url.startswith("data:image/"):
        return None
    match = re.match(r'data:image/(\w+);base64,(.+)', data_url)
    if not match:
        return None
    ext, b64 = match.groups()
    ext = "jpg" if ext == "jpeg" else ext
    img_data = base64.b64decode(b64)
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    with open(filepath, "wb") as f:
        f.write(img_data)
    return filename


def user_to_json(row):
    """Convert a user DB row to the JSON shape the frontend expects."""
    return {
        "id": row["id"],
        "name": row["name"],
        "photo": f"/uploads/{row['photo_filename']}" if row["photo_filename"] else None,
        "answers": json.loads(row["answers"] or "{}"),
        "created_at": row["created_at"],
    }


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})



@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.json
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"error": "email and password required"}), 400

    user_id = str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password, name, answers, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            # hashed, never the plaintext — same column, same response shape
            (user_id, email, generate_password_hash(password), "", "{}", now)
        )
        conn.commit()
    except Exception:
        conn.close()
        return jsonify({"error": "email already exists"}), 409
    conn.close()

    return jsonify({"id": user_id, "token": user_id}), 201


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.json
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()

    # look the password up by email and verify the hash — never match on the
    # password in SQL, which only works if it is stored in the clear
    if not row or not row["password"] or not check_password_hash(row["password"], password):
        return jsonify({"error": "invalid credentials"}), 401

    return jsonify({"id": row["id"], "token": row["id"]})


@app.route("/api/users", methods=["POST"])
def create_user():
    name = request.form.get("name", "")
    age = request.form.get("age", type=int)
    gender = request.form.get("gender", "")
    interested_in = request.form.get("interested_in", "male,female,other")
    
    drawing = request.files.get("drawing")
    photo_filename = None
    
    if drawing:
        photo_filename = f"{uuid.uuid4().hex}_{drawing.filename}"
        drawing.save(os.path.join(UPLOAD_FOLDER, photo_filename))
    
    user_id = str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()

    # Classify inline so a new profile is immediately matchable. A model failure
    # must not cost the user their signup, so it degrades to an unclassified
    # profile that /api/reindex can pick up later.
    result = {"status": "skipped", "reason": "no drawing"}
    if photo_filename:
        try:
            result = classify_file(user_id, photo_filename)
        except ModelUnavailable as exc:
            result = {"status": "error", "reason": str(exc)}
        except Exception as exc:
            result = {"status": "error", "reason": f"{type(exc).__name__}: {exc}"}

    features = result.get("features") or {}
    from social_layer import augment_features
    features = augment_features(features)

    conn = get_db()
    
    conn.execute("""
        INSERT INTO users (id, name, age, gender, interested_in, photo_filename,
                           drawing_class, drawing_confidence, drawing_features, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (user_id, name, age, gender, interested_in, photo_filename,
          result.get("class"), result.get("confidence") or 0.0,
          json.dumps(features), now))

    group_id = None
    if result.get("status") == "ok":
        try:
            group_id = assign_group(conn, user_id, features)
        except Exception as exc:
            app.logger.warning("group assignment failed for %s: %s", user_id, exc)

    conn.commit()
    conn.close()

    return jsonify({
        "id": user_id,
        "name": name,
        "age": age,
        "gender": gender,
        "interested_in": interested_in.split(","),
        "drawing_url": f"/uploads/{photo_filename}" if photo_filename else None,
        "drawing_class": result.get("class"),
        "drawing_confidence": result.get("confidence"),
        "classification_status": result.get("status"),
        "classification_reason": result.get("reason"),
        "group_id": group_id,
        "created_at": now
    }), 201


@app.route("/api/profiles", methods=["POST"])
def create_profile():
    """Create or update profile. Accepts base64 photo from the frontend."""
    data = request.json
    user_id = data.get("user_id")
    name = data.get("name", "").strip()
    photo_b64 = data.get("photo")
    answers = data.get("answers", {})
    
    if not user_id or not name:
        return jsonify({"error": "user_id and name required"}), 400
    
    photo_filename = save_base64_image(photo_b64)
    now = datetime.now().isoformat()

    # Classify here, since this is where the drawing arrives. A model failure
    # must not cost the user their profile — it degrades to unclassified, which
    # POST /api/reindex can pick up later.
    result = {"status": "skipped", "reason": "no drawing"}
    if photo_filename:
        try:
            result = classify_file(user_id, photo_filename)
        except ModelUnavailable as exc:
            result = {"status": "error", "reason": str(exc)}
        except Exception as exc:
            result = {"status": "error", "reason": f"{type(exc).__name__}: {exc}"}

    features = result.get("features") or {}
    from social_layer import augment_features
    features = augment_features(features)

    conn = get_db()
    
    conn.execute("""
        UPDATE users SET name = ?, photo_filename = COALESCE(?, photo_filename),
               answers = ?, created_at = ?, drawing_class = ?,
               drawing_confidence = ?, drawing_features = ?
        WHERE id = ?
    """, (name, photo_filename, json.dumps(answers), now, result.get("class"),
          result.get("confidence") or 0.0, json.dumps(features), user_id))

    group_id = None
    if result.get("status") == "ok" and features.get("similarity_vector"):
        try:
            group_id = assign_group(conn, user_id, features)
        except Exception as exc:
            app.logger.warning("group assignment failed for %s: %s", user_id, exc)

    conn.commit()
    conn.close()

    return jsonify({
        "id": user_id,
        "name": name,
        "photo": f"/uploads/{photo_filename}" if photo_filename else None,
        "answers": answers,
        "drawing_class": result.get("class"),
        "drawing_confidence": result.get("confidence"),
        "classification_status": result.get("status"),
        "classification_reason": result.get("reason"),
        "top_k": features.get("top_k"),
        "group_id": group_id,
        "created_at": now
    })


@app.route("/api/profiles/me", methods=["GET"])
def get_my_profile():
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    
    if not row:
        return jsonify({"error": "not found"}), 404
    
    return jsonify(user_to_json(row))

# Columns safe to hand out. `SELECT *` was fine until the table grew a password
# column — it would now return credentials to any caller.
PUBLIC_USER_COLUMNS = (
    "id, name, age, gender, interested_in, photo_filename, drawing_class, "
    "drawing_confidence, group_id, answers, created_at"
)


@app.route("/api/users", methods=["GET"])
def list_users():
    conn = get_db()
    rows = conn.execute(f"SELECT {PUBLIC_USER_COLUMNS} FROM users").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users/<user_id>", methods=["GET"])
def get_user(user_id):
    conn = get_db()
    row = conn.execute(
        f"SELECT {PUBLIC_USER_COLUMNS} FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify(dict(row))


@app.route("/api/users/<user_id>/matching-profile", methods=["GET"])
def get_matching_profile(user_id):
    conn = get_db()
    row = conn.execute("""
        SELECT id, age, gender, interested_in, photo_filename,
               drawing_class, drawing_confidence, drawing_features
        FROM users WHERE id = ?
    """, (user_id,)).fetchone()
    conn.close()
    
    if not row:
        return jsonify({"error": "not found"}), 404
    
    return jsonify({
        "id": row["id"],
        "age": row["age"],
        "gender": row["gender"],
        "interested_in": row["interested_in"].split(",") if row["interested_in"] else [],
        "photo_filename": row["photo_filename"],
        "drawing_class": row["drawing_class"],
        "drawing_confidence": row["drawing_confidence"],
        "drawing_features": json.loads(row["drawing_features"] or "{}"),
    })



@app.route("/api/users/<user_id>/classify", methods=["POST"])
def classify_drawing(user_id):
    """Run the model on this user's drawing and store the result.

    A JSON body still overrides it (that was the original contract), so an
    external worker can push results in instead.
    """
    data = request.get_json(silent=True) or {}

    conn = get_db()
    row = conn.execute(
        "SELECT photo_filename FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "not found"}), 404

    if data.get("features") or data.get("class"):
        result = {
            "status": "ok",
            "class": data.get("class"),
            "confidence": data.get("confidence", 0.0),
            "features": data.get("features", {}),
        }
    else:
        if not row["photo_filename"]:
            conn.close()
            return jsonify({"error": "user has no drawing"}), 400
        try:
            result = classify_file(user_id, row["photo_filename"])
        except ModelUnavailable as exc:
            conn.close()
            return jsonify({"error": str(exc)}), 503

    features = result.get("features") or {}
    from social_layer import augment_features
    features = augment_features(features)
    conn.execute("""
        UPDATE users SET drawing_class = ?, drawing_confidence = ?, drawing_features = ?
        WHERE id = ?
    """, (result.get("class"), result.get("confidence") or 0.0,
          json.dumps(features), user_id))

    group_id = None
    if result.get("status") == "ok" and features.get("similarity_vector"):
        group_id = assign_group(conn, user_id, features)

    conn.commit()
    conn.close()

    return jsonify({
        "status": result.get("status"),
        "reason": result.get("reason"),
        "class": result.get("class"),
        "confidence": result.get("confidence"),
        "group_id": group_id,
        "top_k": features.get("top_k"),
        "quality": features.get("quality"),
    })


@app.route("/api/users/<user_id>/matches", methods=["GET"])
def get_similar_users(user_id):
    """Rank everyone else by drawing similarity.

    Orientation is a hard gate inside rank_matches, applied BEFORE scoring —
    never folded into the similarity score.
    """
    try:
        from sketch_matcher import rank_matches
    except ImportError as exc:
        return jsonify({"error": f"ML dependencies missing: {exc}"}), 503

    limit = request.args.get("limit", default=20, type=int)
    min_similarity = request.args.get("min_similarity", default=0.0, type=float)

    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, age, gender, interested_in, photo_filename, "
        "drawing_class, drawing_features, group_id FROM users"
    ).fetchall()
    conn.close()

    by_id = {r["id"]: r for r in rows}
    if user_id not in by_id:
        return jsonify({"error": "not found"}), 404

    query = row_to_profile(by_id[user_id])
    if not (query.get("features") or {}).get("similarity_vector"):
        return jsonify({"error": "user has no drawing vector — classify first"}), 409

    candidates = [row_to_profile(r) for r in rows if r["id"] != user_id]
    candidates = [c for c in candidates if (c.get("features") or {}).get("similarity_vector")]

    try:
        ranked = rank_matches(query, candidates, min_similarity=min_similarity, limit=limit)
    except ValueError as exc:
        # raised when vectors came from a different model or class ordering
        return jsonify({"error": str(exc), "hint": "POST /api/reindex"}), 409

    for match in ranked:
        row = by_id.get(match["id"])
        if row:
            match["name"] = row["name"]
            match["drawing_url"] = (
                f"/uploads/{row['photo_filename']}" if row["photo_filename"] else None
            )
            match["group_id"] = row["group_id"]

    try:
        from social_layer import blend_matches
        ranked = blend_matches(query, ranked, by_id)
    except Exception:
        pass

    return jsonify({
        "id": user_id,
        "class": query.get("class"),
        "count": len(ranked),
        "matches": ranked,
    })


@app.route("/api/vectors", methods=["GET"])
def list_vectors():
    """Everyone who has a drawing vector, for client-side graphing.

    The similarity graph needs the vectors themselves (to build kNN links and
    cluster), not just pairwise scores. 250 floats per user is small enough to
    ship whole at this scale.
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, age, gender, interested_in, drawing_class, "
        "drawing_confidence, photo_filename, drawing_features, group_id FROM users"
    ).fetchall()
    conn.close()

    out = []
    for row in rows:
        features = json.loads(row["drawing_features"] or "{}")
        vector = features.get("similarity_vector")
        if not vector:
            continue
        out.append({
            "id": row["id"],
            "name": row["name"] or "someone",
            "gender": row["gender"],
            "interested_in": (row["interested_in"] or "").split(",") if row["interested_in"] else [],
            "class": row["drawing_class"],
            "confidence": row["drawing_confidence"],
            "group_id": row["group_id"],
            "drawing_url": f"/uploads/{row['photo_filename']}" if row["photo_filename"] else None,
            "top_k": features.get("top_k", [])[:3],
            "vector": vector,
        })

    return jsonify({
        "count": len(out),
        "vector_dim": len(out[0]["vector"]) if out else 0,
        "model_version": out[0].get("model_version") if out else None,
        "profiles": out,
    })


@app.route("/api/groups", methods=["GET"])
def list_groups():
    conn = get_db()
    groups = conn.execute("SELECT id, label, size, created_at FROM groups").fetchall()
    members = conn.execute(
        "SELECT id, name, group_id, drawing_class, photo_filename FROM users "
        "WHERE group_id IS NOT NULL"
    ).fetchall()
    conn.close()

    by_group = {}
    for row in members:
        by_group.setdefault(row["group_id"], []).append({
            "id": row["id"],
            "name": row["name"],
            "class": row["drawing_class"],
            "drawing_url": f"/uploads/{row['photo_filename']}" if row["photo_filename"] else None,
        })

    return jsonify([
        {
            "id": g["id"],
            "label": g["label"],
            "size": len(by_group.get(g["id"], [])),
            "created_at": g["created_at"],
            "members": by_group.get(g["id"], []),
        }
        for g in groups
    ])


@app.route("/api/model", methods=["GET"])
def model_info():
    status = model_status()
    return jsonify(status), (200 if status.get("available") else 503)

@app.route("/api/chats/messages", methods=["GET"])
def get_chat_messages():
    user_a = request.args.get("user_a")
    user_b = request.args.get("user_b")
    if not user_a or not user_b:
        return jsonify({"error": "user_a and user_b required"}), 400

    conn = get_db()
    rows = conn.execute("""
        SELECT id, sender_id, recipient_id, body, created_at
        FROM messages
        WHERE (sender_id = ? AND recipient_id = ?)
           OR (sender_id = ? AND recipient_id = ?)
        ORDER BY created_at ASC
    """, (user_a, user_b, user_b, user_a)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/chats/messages", methods=["POST"])
def send_chat_message():
    data = request.json
    sender = data.get("from")
    recipient = data.get("to")
    body = data.get("body", "").strip()

    if not sender or not recipient or not body:
        return jsonify({"error": "from, to, body required"}), 400

    now = datetime.now().isoformat()
    a, b = sorted([sender, recipient])
    thread = f"{a}_{b}"

    conn = get_db()
    conn.execute("""
        INSERT INTO messages (sender_id, recipient_id, body, created_at)
        VALUES (?, ?, ?, ?)
    """, (sender, recipient, body, now))

    existing = conn.execute(
        "SELECT message_count FROM social_feedback WHERE thread_id = ?",
        (thread,)
    ).fetchone()

    if existing:
        conn.execute("""
            UPDATE social_feedback
            SET message_count = message_count + 1,
                last_message_at = ?,
                outcome = 'active'
            WHERE thread_id = ?
        """, (now, thread))
    else:
        conn.execute("""
            INSERT INTO social_feedback
            (user_a, user_b, thread_id, message_count, last_message_at, outcome, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (a, b, thread, 1, now, 'active', now))

    conn.commit()
    conn.close()
    return jsonify({"status": "ok"}), 201

@app.route("/api/reindex", methods=["POST"])
def reindex():
    """Recompute every stored vector with the current model and temperature.

    Needed whenever the checkpoint or SKETCH_TEMPERATURE changes: old vectors stay
    the same length and compare cleanly against new ones while meaning something
    different. Pass ?force=1 to redo even the ones that already look current.
    """
    force = request.args.get("force", default=0, type=int)

    try:
        get_classifier()
    except ModelUnavailable as exc:
        return jsonify({"error": str(exc)}), 503

    conn = get_db()
    rows = conn.execute(
        "SELECT id, photo_filename, drawing_features FROM users "
        "WHERE photo_filename IS NOT NULL"
    ).fetchall()

    # centroids are rebuilt from scratch, since every vector moved
    conn.execute("DELETE FROM groups")
    conn.execute("UPDATE users SET group_id = NULL")

    done, skipped, failed = 0, 0, []
    for row in rows:
        stored = json.loads(row["drawing_features"] or "{}")
        if not force and features_are_current(stored):
            skipped += 1
            continue
        try:
            result = classify_file(row["id"], row["photo_filename"])
        except Exception as exc:
            failed.append({"id": row["id"], "reason": f"{type(exc).__name__}: {exc}"})
            continue

        features = result.get("features") or {}
        from social_layer import augment_features
        features = augment_features(features)
        conn.execute(
            "UPDATE users SET drawing_class = ?, drawing_confidence = ?, "
            "drawing_features = ? WHERE id = ?",
            (result.get("class"), result.get("confidence") or 0.0,
             json.dumps(features), row["id"]),
        )
        
        if result.get("status") == "ok" and features.get("similarity_vector"):
            assign_group(conn, row["id"], features)
            done += 1
        else:
            failed.append({"id": row["id"], "reason": result.get("reason")})

    conn.commit()
    conn.close()
    return jsonify({"reindexed": done, "skipped": skipped, "failed": failed})


@app.route("/api/profiles/feed", methods=["GET"])
def get_feed():
    """Return profiles the current user hasn't swiped on yet."""
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    
    conn = get_db()
    
    swiped = conn.execute(
        "SELECT to_user FROM swipes WHERE from_user = ?", (user_id,)
    ).fetchall()
    excluded = {s["to_user"] for s in swiped}
    excluded.add(user_id)
    
    placeholders = ",".join("?" * len(excluded))
    rows = conn.execute(
        f"SELECT * FROM users WHERE id NOT IN ({placeholders}) AND photo_filename IS NOT NULL",
        list(excluded)
    ).fetchall()
    
    import random
    profiles = [user_to_json(r) for r in rows]
    random.shuffle(profiles)
    
    conn.close()
    return jsonify(profiles)


@app.route("/api/swipes", methods=["POST"])
def swipe():
    data = request.json
    from_id = data.get("from")
    to_id = data.get("to")
    direction = data.get("direction")
    
    if not from_id or not to_id or direction not in ("left", "right"):
        return jsonify({"error": "invalid"}), 400
    
    now = datetime.now().isoformat()
    conn = get_db()
    
    conn.execute("""
        INSERT INTO swipes (from_user, to_user, direction, created_at)
        VALUES (?, ?, ?, ?)
    """, (from_id, to_id, direction, now))
    
    if direction == "right":
        mutual = conn.execute("""
            SELECT 1 FROM swipes 
            WHERE from_user = ? AND to_user = ? AND direction = 'right'
        """, (to_id, from_id)).fetchone()
        
        if mutual:
            match_id = str(uuid.uuid4())[:8]
            a, b = sorted([from_id, to_id])
            conn.execute("""
                INSERT INTO matches (id, user_a, user_b, created_at)
                VALUES (?, ?, ?, ?)
            """, (match_id, a, b, now))
            conn.commit()
            conn.close()
            return jsonify({"match": True, "match_id": match_id})
    
    conn.commit()
    conn.close()
    return jsonify({"match": False})


@app.route("/api/matches", methods=["GET"])
def get_matches():
    """Return mutual matches for the current user."""
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    
    conn = get_db()
    
    rows = conn.execute("""
        SELECT u.* FROM users u
        JOIN matches m ON (u.id = m.user_a OR u.id = m.user_b)
        WHERE (m.user_a = ? OR m.user_b = ?) AND u.id != ?
    """, (user_id, user_id, user_id)).fetchall()
    
    conn.close()
    return jsonify([user_to_json(r) for r in rows])


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

# ---------------------------------------------------------------------------
# Automatic social model retraining
# ---------------------------------------------------------------------------

# Retraining rewrites drawing_features for every user. SQLite allows a single
# writer, so two overlapping runs produce "database is locked" mid-write.
_retrain_lock = threading.Lock()


def scheduled_retrain():
    script = os.path.join(os.path.dirname(__file__), "train_social.py")
    if not os.path.exists(script):
        app.logger.warning("train_social.py not found, skipping scheduled retrain")
        return
    if not _retrain_lock.acquire(blocking=False):
        app.logger.warning("social retrain already running, skipping this trigger")
        return
    try:
        result = subprocess.run(
            [sys.executable, script],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(__file__),
            timeout=300,
        )
        if result.returncode == 0:
            app.logger.info("Scheduled social retrain succeeded")
        else:
            app.logger.warning("Scheduled social retrain failed: %s", result.stderr)
    except Exception as exc:
        app.logger.error("Scheduled social retrain exception: %s", exc)
    finally:
        _retrain_lock.release()


def start_scheduler():
    """Start the nightly retrain. Must run in exactly ONE process.

    This used to run at import time, which starts it twice under Flask's debug
    reloader (parent + child) and once per worker under gunicorn — every copy
    firing its own train_social.py subprocess at the same wall-clock time, all
    writing the same SQLite file.
    """
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        func=scheduled_retrain,
        trigger="cron",
        hour=3,
        minute=0,
        id="social_retrain",
        max_instances=1,   # never overlap with a still-running retrain
        coalesce=True,     # missed triggers collapse into one, not a backlog
    )
    scheduler.start()
    def _stop():
        # shutdown() raises if it is already stopped — atexit would print a
        # traceback on every clean exit
        if scheduler.running:
            scheduler.shutdown(wait=False)

    atexit.register(_stop)
    app.logger.info("social retrain scheduled (03:00 daily)")
    return scheduler


# Under a WSGI server the module is imported, not run, so opt in explicitly —
# and only for one worker.
if os.environ.get("RUN_SCHEDULER") == "1":
    start_scheduler()

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "1") != "0"
    # with the reloader, only the child process (WERKZEUG_RUN_MAIN=true) owns it
    if not debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_scheduler()
    app.run(debug=debug, port=5001)