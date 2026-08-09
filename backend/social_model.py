import os

try:
    import torch
    import torch.nn as nn
    _HAS_TORCH = True
except ImportError:
    torch = None
    nn = None
    _HAS_TORCH = False

SOCIAL_MODEL_PATH = os.path.join(os.path.dirname(__file__), "social_projection.pt")

_model_cache = None
_model_mtime = 0.0


if _HAS_TORCH:
    class SocialProjection(nn.Module):
        def __init__(self, visual_dim=250, social_dim=64):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(visual_dim, 128),
                nn.ReLU(),
                nn.Linear(128, social_dim),
            )

        def forward(self, x):
            v = self.net(x)
            return nn.functional.normalize(v, p=2, dim=-1)
else:
    class SocialProjection:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("torch not installed")


def load_social_model():
    global _model_cache, _model_mtime
    if not _HAS_TORCH or not os.path.exists(SOCIAL_MODEL_PATH):
        _model_cache = None
        _model_mtime = 0.0
        return None

    current_mtime = os.path.getmtime(SOCIAL_MODEL_PATH)
    if _model_cache is not None and current_mtime == _model_mtime:
        return _model_cache

    try:
        model = SocialProjection()
        model.load_state_dict(torch.load(SOCIAL_MODEL_PATH, map_location="cpu"))
        model.eval()
        _model_cache = model
        _model_mtime = current_mtime
        return model
    except Exception:
        _model_cache = None
        _model_mtime = 0.0
        return None