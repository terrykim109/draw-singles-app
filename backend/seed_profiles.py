"""Seed the database with fake profiles for local dev / demos.

Each fake profile gets a real hand-drawn-looking sketch (PIL, black on white),
is classified with the actual model (backend/matching.classify_file), and is
assigned to a similarity group — so seeded users behave exactly like real ones:
they show up in the feed, the constellation, and matches.

Idempotent: run it as many times as you like. Previous seeds (emails matching
seed.%@example.com) are deleted first.

Usage:
    cd backend
    .venv/bin/python seed_profiles.py [N]
"""
import json
import math
import os
import random
import sys
import uuid
from datetime import datetime

from PIL import Image, ImageDraw

BACKEND = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(BACKEND)
for p in (BACKEND, REPO_ROOT):
    if p not in sys.path:
        sys.path.insert(0, p)

from db import get_db                      # noqa: E402
from matching import assign_group, classify_file  # noqa: E402
from social_layer import augment_features   # noqa: E402

UPLOAD_FOLDER = os.path.join(BACKEND, "uploads")
SIZE = 360  # canvas px; the preprocessor autocrops + resizes anyway

INK = 0  # black strokes on white paper

# ---------------------------------------------------------------------------
# drawing generators — one per class we want in the seed
# ---------------------------------------------------------------------------

def draw_cat(draw):
    cx, cy = 180, 185
    draw.ellipse([cx - 70, cy - 55, cx + 70, cy + 70], outline=INK, width=4)          # head
    draw.polygon([(cx - 68, cy - 30), (cx - 92, cy - 105), (cx - 22, cy - 52)], outline=INK, width=4)  # left ear
    draw.polygon([(cx + 68, cy - 30), (cx + 92, cy - 105), (cx + 22, cy - 52)], outline=INK, width=4)  # right ear
    draw.ellipse([cx - 42, cy - 5, cx - 20, cy + 17], fill=INK)                       # left eye
    draw.ellipse([cx + 20, cy - 5, cx + 42, cy + 17], fill=INK)                       # right eye
    draw.polygon([(cx - 7, cy + 20), (cx + 7, cy + 20), (cx, cy + 32)], fill=INK)     # nose
    draw.arc([cx - 22, cy + 26, cx + 22, cy + 62], 20, 160, fill=INK, width=3)        # mouth
    draw.line([(cx - 50, cy + 10), (cx - 82, cy + 6)], width=3)                       # whiskers
    draw.line([(cx - 50, cy + 22), (cx - 82, cy + 22)], width=3)
    draw.line([(cx + 50, cy + 10), (cx + 82, cy + 6)], width=3)
    draw.line([(cx + 50, cy + 22), (cx + 82, cy + 22)], width=3)


def draw_dog(draw):
    cx, cy = 180, 185
    draw.ellipse([cx - 72, cy - 65, cx + 72, cy + 65], outline=INK, width=4)          # head
    draw.ellipse([cx - 105, cy - 55, cx - 48, cy + 40], outline=INK, width=4)         # floppy ear L
    draw.ellipse([cx + 48, cy - 55, cx + 105, cy + 40], outline=INK, width=4)         # floppy ear R
    draw.ellipse([cx - 27, cy - 5, cx - 7, cy + 15], fill=INK)                        # eyes
    draw.ellipse([cx + 7, cy - 5, cx + 27, cy + 15], fill=INK)
    draw.ellipse([cx - 15, cy + 30, cx + 15, cy + 60], outline=INK, width=3)          # nose
    draw.ellipse([cx - 10, cy + 42, cx + 10, cy + 60], fill=INK)                      # nose tip
    draw.arc([cx - 20, cy + 52, cx + 20, cy + 88], 20, 160, fill=INK, width=3)        # mouth


def draw_house(draw):
    draw.rectangle([100, 160, 260, 300], outline=INK, width=4)                        # body
    draw.polygon([(90, 160), (180, 70), (270, 160)], outline=INK)                     # roof
    draw.rectangle([150, 210, 210, 300], outline=INK, width=4)                        # door
    draw.ellipse([198, 245, 210, 257], fill=INK)                                      # knob
    draw.rectangle([115, 180, 150, 215], outline=INK, width=3)                        # window
    draw.line([(132, 180), (132, 215)], width=3)
    draw.line([(115, 197), (150, 197)], width=3)
    draw.rectangle([210, 180, 245, 215], outline=INK, width=3)
    draw.line([(227, 180), (227, 215)], width=3)
    draw.line([(210, 197), (245, 197)], width=3)


def draw_car(draw):
    draw.rounded_rectangle([70, 190, 290, 270], radius=18, outline=INK, width=4)      # body
    draw.polygon([(100, 190), (135, 120), (225, 120), (265, 190)], outline=INK)       # cabin
    draw.rectangle([150, 135, 210, 185], outline=INK, width=3)                        # window
    draw.ellipse([95, 250, 160, 315], outline=INK, width=4)                           # wheel L
    draw.ellipse([200, 250, 265, 315], outline=INK, width=4)                          # wheel R
    draw.ellipse([118, 273, 137, 292], outline=INK, width=2)
    draw.ellipse([223, 273, 242, 292], outline=INK, width=2)


def draw_flower(draw):
    draw.line([(180, 200), (180, 325)], width=4)                                      # stem
    draw.line([(180, 285), (140, 250)], width=4)                                      # leaf L
    draw.line([(180, 270), (220, 235)], width=4)                                      # leaf R
    # tulip cup: three petals + back rim
    draw.arc([125, 95, 175, 195], 90, 270, fill=INK, width=4)                         # left petal
    draw.arc([185, 95, 235, 195], 270, 90, fill=INK, width=4)                         # right petal
    draw.arc([150, 60, 210, 135], 0, 180, fill=INK, width=4)                          # center petal
    draw.arc([130, 95, 230, 195], 40, 140, fill=INK, width=4)                         # back rim


def draw_sun(draw):
    cx, cy = 180, 180
    draw.ellipse([cx - 55, cy - 55, cx + 55, cy + 55], outline=INK, width=4)
    for i in range(12):                                                               # rays
        a = i * math.pi / 6
        x1, y1 = cx + 70 * math.cos(a), cy + 70 * math.sin(a)
        x2, y2 = cx + 100 * math.cos(a), cy + 100 * math.sin(a)
        draw.line([(x1, y1), (x2, y2)], width=4)
    draw.ellipse([cx - 40, cy - 40, cx + 40, cy + 40], outline=INK, width=3)


def draw_fish(draw):
    cx, cy = 175, 180
    draw.ellipse([cx - 95, cy - 60, cx + 85, cy + 60], outline=INK, width=4)          # body
    draw.polygon([(cx + 75, cy - 10), (cx + 135, cy - 60), (cx + 135, cy + 60), (cx + 75, cy + 10)], outline=INK)  # tail
    draw.ellipse([cx - 55, cy - 12, cx - 25, cy + 18], outline=INK, width=3)          # eye
    draw.arc([cx - 20, cy - 25, cx + 20, cy + 25], 300, 60, fill=INK, width=3)        # mouth
    draw.polygon([(cx - 40, cy - 55), (cx - 10, cy - 35), (cx - 45, cy - 25)], outline=INK, width=3)  # fin


def draw_tree(draw):
    draw.rectangle([172, 250, 198, 325], outline=INK, width=4)                        # trunk
    draw.ellipse([125, 130, 245, 250], outline=INK, width=4)                          # leaf blob
    draw.arc([115, 160, 155, 210], 90, 270, fill=INK, width=4)                        # side bumps
    draw.arc([215, 160, 255, 210], 270, 90, fill=INK, width=4)
    draw.arc([140, 105, 180, 150], 0, 180, fill=INK, width=4)                         # top bumps
    draw.arc([190, 105, 230, 150], 0, 180, fill=INK, width=4)


def draw_airplane(draw):
    draw.ellipse([60, 160, 300, 200], outline=INK, width=4)                           # fuselage
    draw.polygon([(110, 180), (60, 80), (140, 160)], outline=INK)                     # wing up
    draw.polygon([(110, 180), (60, 280), (140, 200)], outline=INK)                    # wing down
    draw.polygon([(265, 165), (310, 110), (300, 185)], outline=INK)                   # tail
    draw.arc([120, 168, 190, 192], 0, 180, fill=INK, width=3)                         # window


def draw_heart(draw):
    pts = []
    for i in range(90):
        t = i * 2 * math.pi / 90
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((180 + x * 9.5, 170 - y * 9.5))
    draw.polygon(pts, outline=INK)


def draw_mushroom(draw):
    draw.arc([90, 100, 270, 240], 0, 180, fill=INK, width=5)                          # cap
    draw.line([(90, 170), (270, 170)], width=5)                                       # cap base
    draw.rectangle([165, 170, 200, 320], outline=INK, width=4)                        # stem
    draw.ellipse([155, 300, 215, 320], outline=INK, width=3)                          # base
    draw.ellipse([135, 130, 155, 150], fill=INK)                                      # spots
    draw.ellipse([205, 115, 228, 138], fill=INK)
    draw.ellipse([170, 200, 190, 220], fill=INK)


def draw_lamp(draw):
    draw.rectangle([170, 180, 190, 320], outline=INK, width=4)                        # pole
    draw.rectangle([140, 310, 220, 330], outline=INK, width=4)                        # base
    draw.polygon([(120, 180), (240, 180), (205, 110), (155, 110)], outline=INK)       # shade
    draw.line([(140, 115), (220, 115)], width=3)
    draw.arc([155, 180, 205, 230], 180, 360, fill=INK, width=3)                       # bulb


def draw_umbrella(draw):
    draw.arc([60, 80, 300, 280], 180, 360, fill=INK, width=5)                         # canopy
    draw.line([(180, 205), (180, 330)], width=4)                                      # pole
    draw.line([(60, 180), (300, 180)], width=4)                                       # scallop base
    draw.arc([160, 315, 205, 355], 180, 360, fill=INK, width=4)                       # handle hook
    draw.line([(115, 160), (115, 200)], width=3)                                      # ribs
    draw.line([(180, 140), (180, 205)], width=3)
    draw.line([(245, 160), (245, 200)], width=3)


def draw_cup(draw):
    draw.rectangle([110, 140, 250, 280], outline=INK, width=4)                        # mug
    draw.arc([245, 160, 305, 260], 270, 90, fill=INK, width=4)                        # handle
    draw.line([(100, 140), (260, 140)], width=4)                                      # rim
    draw.ellipse([110, 240, 250, 300], outline=INK, width=4)                          # saucer


def draw_bicycle(draw):
    draw.ellipse([80, 200, 180, 300], outline=INK, width=4)                           # wheel L
    draw.ellipse([240, 200, 340, 300], outline=INK, width=4)                          # wheel R
    draw.line([(80, 250), (180, 250)], width=2)
    draw.line([(240, 250), (340, 250)], width=2)
    draw.line([(130, 250), (210, 170)], width=4)                                      # frame
    draw.line([(210, 170), (290, 250)], width=4)
    draw.line([(130, 250), (290, 250)], width=4)
    draw.line([(210, 170), (240, 130)], width=4)                                      # fork
    draw.line([(210, 170), (255, 140)], width=4)                                      # handlebar
    draw.arc([190, 120, 230, 160], 0, 180, fill=INK, width=4)                         # seat


def draw_butterfly(draw):
    draw.line([(180, 90), (180, 270)], width=4)                                       # body
    draw.ellipse([110, 70, 250, 180], outline=INK, width=4)                           # top wings
    draw.ellipse([115, 90, 245, 200], outline=INK, width=3)
    draw.ellipse([130, 190, 235, 280], outline=INK, width=4)                          # bottom wings
    draw.ellipse([140, 205, 225, 275], outline=INK, width=3)
    draw.arc([170, 235, 190, 265], 0, 360, fill=INK, width=2)                         # head
    draw.line([(180, 80), (185, 60)], width=3)                                        # antennae
    draw.line([(180, 80), (175, 60)], width=3)


def draw_elephant(draw):
    cx, cy = 175, 200
    draw.ellipse([cx - 95, cy - 60, cx + 95, cy + 80], outline=INK, width=4)          # body
    draw.ellipse([cx - 130, cy - 85, cx - 20, cy + 30], outline=INK, width=4)         # ear L
    draw.ellipse([cx - 65, cy - 95, cx + 30, cy - 5], outline=INK, width=4)           # head
    draw.arc([cx - 35, cy - 25, cx + 55, cy + 55], 30, 200, fill=INK, width=4)        # trunk
    draw.ellipse([cx - 40, cy - 75, cx - 12, cy - 47], outline=INK, width=3)          # eye
    draw.rectangle([cx - 75, cy + 70, cx - 45, cy + 115], outline=INK, width=4)       # legs
    draw.rectangle([cx + 25, cy + 70, cx + 55, cy + 115], outline=INK, width=4)


def draw_star(draw):
    pts = []
    for i in range(10):
        r = 115 if i % 2 == 0 else 50
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((180 + r * math.cos(a), 180 + r * math.sin(a)))
    draw.polygon(pts, outline=INK)


def draw_moon(draw):
    draw.arc([70, 70, 270, 270], 60, 330, fill=INK, width=5)                          # outer arc
    draw.arc([125, 70, 325, 270], 120, 300, fill=INK, width=5)                        # inner arc (crescent)


def draw_cloud(draw):
    for (dx, dy, r) in [(-55, -10, 42), (0, -30, 50), (55, -10, 42)]:
        draw.ellipse([180 + dx - r, 180 + dy - r, 180 + dx + r, 180 + dy + r], outline=INK, width=4)
    draw.ellipse([130, 5, 230, 105], outline=INK, width=4)                            # bottom bulge
    draw.arc([100, 60, 155, 115], 180, 360, fill=INK, width=4)                        # wavy underside
    draw.arc([155, 60, 210, 115], 180, 360, fill=INK, width=4)
    draw.arc([210, 60, 265, 115], 180, 360, fill=INK, width=4)


def draw_bird(draw):
    draw.ellipse([110, 150, 220, 240], outline=INK, width=4)                          # body
    draw.ellipse([205, 110, 275, 175], outline=INK, width=4)                          # head
    draw.polygon([(265, 130), (310, 120), (275, 150)], outline=INK)                   # beak
    draw.ellipse([235, 125, 255, 145], outline=INK, width=2)                          # eye
    draw.arc([150, 160, 260, 230], 200, 340, fill=INK, width=4)                       # wing
    draw.line([(150, 235), (120, 300)], width=3)                                      # legs
    draw.line([(165, 235), (135, 300)], width=3)
    draw.line([(105, 295), (140, 295)], width=3)
    draw.line([(120, 295), (155, 295)], width=3)


def draw_frog(draw):
    cx, cy = 180, 200
    draw.ellipse([cx - 80, cy - 55, cx + 80, cy + 65], outline=INK, width=4)          # body
    draw.ellipse([cx - 65, cy - 105, cx - 25, cy - 45], outline=INK, width=4)         # eye L
    draw.ellipse([cx + 25, cy - 105, cx + 65, cy - 45], outline=INK, width=4)         # eye R
    draw.ellipse([cx - 50, cy - 80, cx - 12, cy - 42], outline=INK, width=2)
    draw.ellipse([cx + 12, cy - 80, cx + 50, cy - 42], outline=INK, width=2)
    draw.arc([cx - 30, cy - 5, cx + 30, cy + 40], 20, 160, fill=INK, width=3)         # mouth
    draw.arc([cx - 120, cy - 20, cx - 60, cy + 40], 200, 340, fill=INK, width=4)      # leg L
    draw.arc([cx + 60, cy - 20, cx + 120, cy + 40], 200, 340, fill=INK, width=4)      # leg R


def draw_icecream(draw):
    draw.polygon([(140, 190), (220, 190), (180, 330)], outline=INK)                   # cone
    draw.line([(160, 230), (195, 230)], width=3)
    draw.line([(170, 265), (190, 265)], width=3)
    draw.ellipse([115, 100, 245, 230], outline=INK, width=4)                          # scoop
    draw.ellipse([125, 115, 235, 225], outline=INK, width=3)


def draw_rabbit(draw):
    cx, cy = 180, 200
    draw.ellipse([cx - 60, cy - 40, cx + 60, cy + 60], outline=INK, width=4)          # head
    draw.ellipse([cx - 50, cy - 150, cx - 5, cy - 25], outline=INK, width=4)          # ear L
    draw.ellipse([cx + 5, cy - 150, cx + 50, cy - 25], outline=INK, width=4)          # ear R
    draw.ellipse([cx - 35, cy - 5, cx - 12, cy + 18], outline=INK, width=2)           # eyes
    draw.ellipse([cx + 12, cy - 5, cx + 35, cy + 18], outline=INK, width=2)
    draw.ellipse([cx - 8, cy + 15, cx + 8, cy + 31], fill=INK)                        # nose
    draw.line([(cx, cy + 31), (cx, cy + 45)], width=2)
    draw.line([(cx - 50, cy + 20), (cx - 85, cy + 10)], width=2)                      # whiskers
    draw.line([(cx - 50, cy + 30), (cx - 85, cy + 35)], width=2)
    draw.line([(cx + 50, cy + 20), (cx + 85, cy + 10)], width=2)
    draw.line([(cx + 50, cy + 30), (cx + 85, cy + 35)], width=2)


def draw_sailboat(draw):
    draw.polygon([(90, 260), (300, 260), (195, 320)], outline=INK)                    # hull
    draw.line([(195, 120), (195, 265)], width=4)                                      # mast
    draw.polygon([(195, 130), (285, 225), (195, 225)], outline=INK)                   # sail R
    draw.polygon([(195, 140), (105, 225), (195, 225)], outline=INK)                   # sail L
    draw.polygon([(175, 255), (215, 255), (195, 270)], outline=INK)                   # flag


def draw_apple(draw):
    draw.ellipse([105, 120, 255, 270], outline=INK, width=4)                          # body
    draw.arc([130, 130, 230, 230], 30, 150, fill=INK, width=3)                        # bite/arc
    draw.line([(180, 120), (180, 85)], width=4)                                       # stem
    draw.ellipse([165, 70, 205, 110], outline=INK, width=3)                           # leaf


def draw_banana(draw):
    # open crescent: outer + inner arcs with pointed, clearly-open tips
    draw.arc([80, 120, 300, 300], 195, 345, fill=INK, width=6)                        # outer curve
    draw.arc([110, 165, 300, 270], 200, 335, fill=INK, width=4)                       # inner curve
    draw.line([(98, 252), (82, 232)], width=6)                                        # bottom tip
    draw.line([(286, 168), (302, 148)], width=6)                                      # top tip


def draw_candle(draw):
    draw.rectangle([150, 150, 210, 310], outline=INK, width=4)                        # body
    draw.line([(150, 150), (210, 150)], width=3)                                      # top
    draw.line([(180, 120), (180, 150)], width=2)                                      # wick
    draw.ellipse([158, 75, 202, 140], outline=INK, width=3)                           # flame
    draw.arc([150, 150, 210, 240], 180, 360, fill=INK, width=2)                       # drip


def draw_envelope(draw):
    draw.rectangle([70, 90, 290, 270], outline=INK, width=4)
    draw.polygon([(70, 90), (180, 195), (290, 90)], outline=INK)
    draw.line([(70, 270), (180, 195)], width=3)
    draw.line([(290, 270), (180, 195)], width=3)
    draw.rectangle([200, 175, 255, 215], outline=INK, width=3)                        # stamp


def draw_snowman(draw):
    draw.ellipse([100, 200, 260, 330], outline=INK, width=4)                          # bottom
    draw.ellipse([125, 120, 235, 215], outline=INK, width=4)                          # middle
    draw.ellipse([150, 55, 210, 125], outline=INK, width=4)                           # head
    draw.rectangle([140, 15, 220, 55], outline=INK, width=4)                          # hat
    draw.line([(130, 55), (230, 55)], width=4)
    draw.ellipse([160, 65, 172, 77], fill=INK)                                        # eyes
    draw.ellipse([188, 65, 200, 77], fill=INK)
    draw.polygon([(180, 80), (186, 100), (174, 100)], fill=INK)                       # carrot
    draw.line([(130, 100), (105, 105)], width=3)                                      # stick arm
    draw.line([(230, 100), (255, 105)], width=3)
    draw.ellipse([148, 160, 160, 172], fill=INK)                                      # buttons
    draw.ellipse([178, 170, 190, 182], fill=INK)
    draw.ellipse([205, 155, 217, 167], fill=INK)


# ---------------------------------------------------------------------------
# the fake people
# ---------------------------------------------------------------------------

MEDIUM = ["pencil", "ballpoint pen", "crayon", "tablet"]
STYLE = ["stick figures", "suspiciously good", "abstract", "unhinged"]
LOOKING = ["a doodle partner", "gallery dates", "something serious", "no idea yet"]

NAMES = [
    "Milo", "Priya", "Dante", "June", "Kofi", "Sasha", "Ezra", "Lena", "Omar", "Tessa",
    "Ravi", "Nina", "Theo", "Yuki", "Marco", "Ivy", "Soren", "Amara", "Felix", "Zoe",
    "Hugo", "Cleo", "Idris", "Wren", "Ari", "Nadia", "Jules", "Petra", "Simon", "Ada",
]

SEED_EMAILS = [f"seed.{i}@example.com" for i in range(len(NAMES))]

# The strongest-drawing classes, repeated so the corpus has real clusters: cat
# people match cat people, house people match house people, etc.
CLUSTERS = [
    draw_cat, draw_cat, draw_cat,
    draw_house, draw_house, draw_house,
    draw_sun, draw_sun,
    draw_fish, draw_fish,
    draw_airplane, draw_airplane,
    draw_bicycle, draw_bicycle,
    draw_sailboat, draw_sailboat,
    draw_candle, draw_candle,
    draw_umbrella, draw_umbrella,
    draw_snowman, draw_snowman,
    draw_rabbit, draw_rabbit,
    draw_moon, draw_moon,
    draw_lamp, draw_lamp,
    draw_envelope, draw_envelope,
]

DRAWERS = CLUSTERS

GENDERS = ["female", "male", "nonbinary", "other"]

# interested_in: women->men, men->women, nonbinary/other->any (wildcard),
# so the mutual-orientation gate in sketch_matcher.is_eligible lets matches happen
INTERESTED_IN = {
    "female": "male",
    "male": "female",
    "nonbinary": "any",
    "other": "any",
}


def profile_for(i: int) -> dict:
    """Deterministic-ish fake person #i."""
    gender = GENDERS[i % len(GENDERS)]
    return {
        "name": NAMES[i],
        "email": SEED_EMAILS[i],
        "age": 19 + (i * 7) % 17,           # 19..35
        "gender": gender,
        "interested_in": INTERESTED_IN[gender],
        "answers": {
            "medium": MEDIUM[i % len(MEDIUM)],
            "style": STYLE[(i // 2) % len(STYLE)],
            "looking": LOOKING[(i + 3) % len(LOOKING)],
        },
        "draw": DRAWERS[i % len(DRAWERS)],
    }


def render(draw_fn, variant: int) -> Image.Image:
    """Draw, then shift + scale by a per-user variant so identical classes are
    similar-but-not-identical (realistic), while staying clearly the same object."""
    im = Image.new("L", (SIZE, SIZE), color=255)
    draw = ImageDraw.Draw(im)
    draw_fn(draw)

    rng = random.Random(variant)
    bbox = im.getbbox()
    if bbox and variant:
        x0, y0, x1, y1 = bbox
        s = rng.uniform(0.72, 0.95)
        nw = max(int((x1 - x0) * s), 1)
        nh = max(int((y1 - y0) * s), 1)
        art = im.crop(bbox).resize((nw, nh), Image.LANCZOS)
        im = Image.new("L", (SIZE, SIZE), color=255)
        im.paste(art, (rng.randint(8, 70), rng.randint(8, 70)))
    return im


def clear_seeds(conn):
    emails = ",".join("?" for _ in SEED_EMAILS)
    rows = conn.execute(
        f"SELECT id, photo_filename FROM users WHERE email IN ({emails})", SEED_EMAILS
    ).fetchall()
    ids = [r["id"] for r in rows]
    if not ids:
        return
    placeholders = ",".join("?" for _ in ids)
    conn.execute(f"DELETE FROM swipes WHERE from_user IN ({placeholders}) OR to_user IN ({placeholders})", ids * 2)
    conn.execute(f"DELETE FROM matches WHERE user_a IN ({placeholders}) OR user_b IN ({placeholders})", ids * 2)
    conn.execute(f"DELETE FROM messages WHERE sender_id IN ({placeholders}) OR recipient_id IN ({placeholders})", ids * 2)
    conn.execute(f"DELETE FROM users WHERE id IN ({placeholders})", ids)

    # remove the drawing files of deleted seeds so uploads/ doesn't grow forever
    for r in rows:
        fn = r["photo_filename"]
        if fn:
            try:
                os.remove(os.path.join(UPLOAD_FOLDER, fn))
            except OSError:
                pass


def prune_groups(conn):
    """Delete groups nobody belongs to anymore (re-seeding orphans them)."""
    orphaned = [
        r["id"] for r in conn.execute(
            "SELECT id FROM groups WHERE id NOT IN (SELECT DISTINCT group_id FROM users WHERE group_id IS NOT NULL)"
        ).fetchall()
    ]
    for gid in orphaned:
        conn.execute("DELETE FROM groups WHERE id = ?", (gid,))
    return len(orphaned)


def seed(n: int | None = None) -> int:
    n = n or len(NAMES)
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    conn = get_db()
    clear_seeds(conn)
    conn.commit()

    created = 0
    for i in range(min(n, len(NAMES))):
        p = profile_for(i)

        # 1. draw + save (varied so same-class drawings are similar, not identical)
        im = render(p["draw"], variant=i)
        filename = f"{uuid.uuid4().hex}.png"
        im.save(os.path.join(UPLOAD_FOLDER, filename))

        # 2. classify with the real model (also writes nothing; we insert below)
        result = classify_file(f"seed-{i}", filename)
        features = augment_features(result.get("features") or {})
        drawing_class = result.get("class")
        confidence = result.get("confidence") or 0.0

        # 3. insert user
        user_id = uuid.uuid4().hex[:8]
        now = datetime.now().isoformat()
        conn.execute(
            """INSERT INTO users (id, email, name, age, gender, interested_in,
                                  photo_filename, answers, drawing_class,
                                  drawing_confidence, drawing_features, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, p["email"], p["name"], p["age"], p["gender"],
             p["interested_in"], filename, json.dumps(p["answers"]),
             drawing_class, confidence, json.dumps(features), now),
        )
        conn.commit()

        # 4. assign to a similarity group (needs the vector in the DB first)
        group_id = None
        if result.get("status") == "ok" and features.get("similarity_vector"):
            group_id = assign_group(conn, user_id, features)
        conn.commit()

        status = result.get("status", "error")
        print(f"[{i + 1:2d}/{min(n, len(NAMES))}] {p['name']:<8} {p['age']} {p['gender']:<10} "
              f"-> {drawing_class or '?'} ({confidence:.2f}) [{status}] group={group_id}")
        created += 1

    pruned = prune_groups(conn)
    conn.commit()
    conn.close()
    if pruned:
        print(f"cleaned {pruned} orphaned group(s)")
    return created


if __name__ == "__main__":
    count = int(sys.argv[1]) if len(sys.argv) > 1 else None
    print(f"seeding {count or len(NAMES)} fake profiles...")
    created = seed(count)
    print(f"done: {created} profiles created")
