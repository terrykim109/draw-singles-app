import json


def _get_torch():
    try:
        import torch
        return torch
    except ImportError:
        return None


def _get_model():
    try:
        from social_model import load_social_model
        return load_social_model()
    except Exception:
        return None


def augment_features(features: dict) -> dict:
    if not features or not features.get("similarity_vector"):
        return features

    torch = _get_torch()
    if torch is None:
        return features

    model = _get_model()
    if model is None:
        return features

    try:
        vec = torch.tensor(features["similarity_vector"], dtype=torch.float32)
        with torch.no_grad():
            social = model(vec).tolist()
        features = dict(features)
        features["social_vector"] = social
        features["social_version"] = 1
        return features
    except Exception:
        return features


def blend_matches(query_profile, ranked_matches, by_id_rows):
    torch = _get_torch()
    if torch is None:
        return ranked_matches

    model = _get_model()
    if model is None:
        return ranked_matches

    q_features = (query_profile.get("features") or {})
    q_social = q_features.get("social_vector")
    if q_social is None:
        return ranked_matches

    q_tensor = torch.tensor(q_social, dtype=torch.float32)

    for match in ranked_matches:
        row = by_id_rows.get(match["id"])
        if not row or not row["drawing_features"]:
            continue
        c_features = json.loads(row["drawing_features"] or "{}")
        c_social = c_features.get("social_vector")
        if c_social is None:
            continue

        c_tensor = torch.tensor(c_social, dtype=torch.float32)
        sim = torch.nn.functional.cosine_similarity(
            q_tensor.unsqueeze(0), c_tensor.unsqueeze(0), dim=1
        ).item()

        match["social_similarity"] = round(sim, 4)
        visual = match.get("similarity", 0)
        match["combined_score"] = round(0.7 * visual + 0.3 * sim, 4)

    ranked_matches.sort(
        key=lambda m: m.get("combined_score", m.get("similarity", 0)),
        reverse=True
    )
    return ranked_matches