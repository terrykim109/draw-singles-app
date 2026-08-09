import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "drawsingles.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            password TEXT,
            name TEXT,
            photo_filename TEXT,
            answers TEXT,
            created_at TEXT
        )
    """)
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
    conn.commit()
    conn.close()