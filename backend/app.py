from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import uuid
import os
import json
import re
import base64
from datetime import datetime
from db import init_db, get_db

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
            (user_id, email, password, "", "{}", now)
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
    row = conn.execute(
        "SELECT * FROM users WHERE email = ? AND password = ?",
        (email, password)
    ).fetchone()
    conn.close()
    
    if not row:
        return jsonify({"error": "invalid credentials"}), 401
    
    return jsonify({"id": row["id"], "token": row["id"]})


@app.route("/api/users", methods=["POST"])
def create_user():
    name = request.form.get("name", "")
    age = request.form.get("age", type=int)
    gender = request.form.get("gender", "")
    interested_in = request.form.get("interested_in", "male,female,other")
    
    drawing = request.files.get("drawing")
    drawing_filename = None
    
    if drawing:
        drawing_filename = f"{uuid.uuid4().hex}_{drawing.filename}"
        drawing.save(os.path.join(UPLOAD_FOLDER, drawing_filename))
    
    user_id = str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()
    
    conn = get_db()
    conn.execute("""
        INSERT INTO users (id, name, age, gender, interested_in, drawing_filename,
                           drawing_class, drawing_confidence, drawing_features, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (user_id, name, age, gender, interested_in, drawing_filename,
          None, 0.0, "{}", now))
    conn.commit()
    conn.close()
    
    return jsonify({
        "id": user_id,
        "name": name,
        "age": age,
        "gender": gender,
        "interested_in": interested_in.split(","),
        "drawing_url": f"/uploads/{drawing_filename}" if drawing_filename else None,
        "drawing_class": None,
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
    
    conn = get_db()
    conn.execute("""
        UPDATE users SET name = ?, photo_filename = ?, answers = ?, created_at = ?
        WHERE id = ?
    """, (name, photo_filename, json.dumps(answers), now, user_id))
    conn.commit()
    conn.close()
    
    return jsonify({
        "id": user_id,
        "name": name,
        "photo": f"/uploads/{photo_filename}" if photo_filename else None,
        "answers": answers,
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

@app.route("/api/users", methods=["GET"])
def list_users():
    conn = get_db()
    rows = conn.execute("SELECT * FROM users").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users/<user_id>", methods=["GET"])
def get_user(user_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify(dict(row))


@app.route("/api/users/<user_id>/matching-profile", methods=["GET"])
def get_matching_profile(user_id):
    conn = get_db()
    row = conn.execute("""
        SELECT id, age, gender, interested_in, drawing_filename,
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
        "drawing_filename": row["drawing_filename"],
        "drawing_class": row["drawing_class"],
        "drawing_confidence": row["drawing_confidence"],
        "drawing_features": json.loads(row["drawing_features"] or "{}"),
    })



@app.route("/api/users/<user_id>/classify", methods=["POST"])
def classify_drawing(user_id):
    data = request.json
    conn = get_db()
    conn.execute("""
        UPDATE users SET drawing_class = ?, drawing_confidence = ?, drawing_features = ?
        WHERE id = ?
    """, (data.get("class"), data.get("confidence", 0.0), json.dumps(data.get("features", {})), user_id))
    conn.commit()
    conn.close()
    return jsonify({"status": "classified"})


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

if __name__ == "__main__":
    app.run(debug=True, port=5001)