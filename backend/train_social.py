import os
import json
import torch
import torch.nn as nn
from db import get_db
from social_model import SocialProjection, SOCIAL_MODEL_PATH


def get_visual_vector(conn, user_id):
    row = conn.execute(
        "SELECT drawing_features FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if not row or not row["drawing_features"]:
        return None
    features = json.loads(row["drawing_features"])
    return features.get("similarity_vector")


def mine_triplets(conn, min_good=6, max_bad=2):
    rows = conn.execute("""
        SELECT
            CASE WHEN sender_id < recipient_id THEN sender_id ELSE recipient_id END as a,
            CASE WHEN sender_id < recipient_id THEN recipient_id ELSE sender_id END as b,
            COUNT(*) as msg_count
        FROM messages
        GROUP BY a, b
    """).fetchall()

    from collections import defaultdict
    good = defaultdict(list)
    bad = defaultdict(list)

    for r in rows:
        a, b, count = r["a"], r["b"], r["msg_count"]
        if count >= min_good:
            good[a].append(b)
            good[b].append(a)
        elif count <= max_bad:
            bad[a].append(b)
            bad[b].append(a)

    triplets = []
    for anchor, positives in good.items():
        negatives = bad.get(anchor, [])
        if not negatives:
            continue
        a_vec = get_visual_vector(conn, anchor)
        p_vec = get_visual_vector(conn, positives[0])
        n_vec = get_visual_vector(conn, negatives[0])
        if a_vec and p_vec and n_vec:
            triplets.append((a_vec, p_vec, n_vec))

    return triplets


def train():
    conn = get_db()
    triplets = mine_triplets(conn)

    if len(triplets) < 3:
        print(f"Only {len(triplets)} triplet(s). Need 3+. Chat more!")
        conn.close()
        return

    model = SocialProjection()
    if os.path.exists(SOCIAL_MODEL_PATH):
        model.load_state_dict(torch.load(SOCIAL_MODEL_PATH, map_location="cpu"))

    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.TripletMarginLoss(margin=0.3)

    a_batch = torch.tensor([t[0] for t in triplets], dtype=torch.float32)
    p_batch = torch.tensor([t[1] for t in triplets], dtype=torch.float32)
    n_batch = torch.tensor([t[2] for t in triplets], dtype=torch.float32)

    best_loss = float('inf')
    for epoch in range(120):
        model.train()
        optimizer.zero_grad()
        a = model(a_batch)
        p = model(p_batch)
        n = model(n_batch)
        loss = loss_fn(a, p, n)
        loss.backward()
        optimizer.step()

        if loss.item() < best_loss:
            best_loss = loss.item()
            tmp_path = SOCIAL_MODEL_PATH + ".tmp"
            torch.save(model.state_dict(), tmp_path)
            os.replace(tmp_path, SOCIAL_MODEL_PATH)
        if epoch % 20 == 0:
            print(f"epoch {epoch:03d}  loss: {loss.item():.4f}")

    print(f"Trained on {len(triplets)} triplets. Best loss: {best_loss:.4f}")

    model.eval()
    rows = conn.execute(
        "SELECT id, drawing_features FROM users WHERE drawing_features IS NOT NULL"
    ).fetchall()
    for row in rows:
        features = json.loads(row["drawing_features"] or "{}")
        vec = features.get("similarity_vector")
        if not vec:
            continue
        with torch.no_grad():
            social = model(torch.tensor(vec, dtype=torch.float32)).tolist()
        features["social_vector"] = social
        conn.execute(
            "UPDATE users SET drawing_features = ? WHERE id = ?",
            (json.dumps(features), row["id"])
        )
    conn.commit()
    conn.close()
    print("All social vectors updated.")


if __name__ == "__main__":
    train()