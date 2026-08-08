from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import uuid
import os
import json
from datetime import datetime
from db import init_db, get_db

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

init_db()

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

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

# Algorithm feed: only matching-relevant fields (no name)
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

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == "__main__":
    app.run(debug=True, port=5001)