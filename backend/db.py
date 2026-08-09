"""SQLite access + schema.

Base schema is the auth/profile/swipe one; the classifier's columns are added on
top of it. Single source of truth for the drawing file is `photo_filename` — the
matcher reads whatever the profile endpoints wrote.
"""
import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), "drawsingles.db")

USERS_COLUMNS = {
    "id": "TEXT PRIMARY KEY",
    "email": "TEXT UNIQUE",
    "password": "TEXT",
    "name": "TEXT",
    "photo_filename": "TEXT",
    "answers": "TEXT",
    # matching inputs
    "age": "INTEGER",
    "gender": "TEXT",
    "interested_in": "TEXT",
    # classifier output
    "drawing_class": "TEXT",
    "drawing_confidence": "REAL",
    "drawing_features": "TEXT",
    "group_id": "TEXT",
    "created_at": "TEXT",
}


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()

    conn.execute(
        "CREATE TABLE IF NOT EXISTS users ("
        + ", ".join(f"{name} {decl}" for name, decl in USERS_COLUMNS.items())
        + ")"
    )

    conn.execute("""
        CREATE TABLE IF NOT EXISTS swipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user TEXT,
            to_user TEXT,
            direction TEXT,
            created_at TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS matches (
            id TEXT PRIMARY KEY,
            user_a TEXT,
            user_b TEXT,
            created_at TEXT
        )
    """)

    # centroids for nearest-centroid typing; see matching.assign_group
    conn.execute("""
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            label TEXT,
            centroid TEXT,
            size INTEGER DEFAULT 0,
            model_version TEXT,
            classes_sha1 TEXT,
            created_at TEXT
        )
    """)

    # add any column a running database is missing, so an existing db keeps working
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    for name, decl in USERS_COLUMNS.items():
        if name not in existing:
            kind = decl.split()[0]
            conn.execute(f"ALTER TABLE users ADD COLUMN {name} {kind}")

    conn.commit()
    conn.close()
