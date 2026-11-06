"""Iter22 FE seed/cleanup: TEST admin + fresh user (no outfit), wardrobe items, finished match with scorers/MOTM.
Usage: python seed_iter22_fe.py seed|clean|state"""
import io
import os
import sys
from datetime import datetime, timezone, timedelta

import pymongo
import requests
from dotenv import load_dotenv
from PIL import Image, ImageDraw

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN, ATOK = "TEST_it22_admin", "TEST_tok_it22_admin"
USER, UTOK = "TEST_it22_fresh", "TEST_tok_it22_fresh"
MID = "mt_TEST_it22"
IDS_FILE = "/tmp/it22_wardrobe_ids.txt"


def png(color, shape="rect"):
    im = Image.new("RGBA", (200, 400), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if shape == "body":
        d.ellipse((70, 10, 130, 70), fill=color)
        d.rectangle((60, 75, 140, 390), fill=color)
    else:
        d.rectangle((20, 20, 180, 380), fill=color)
    b = io.BytesIO()
    im.save(b, "PNG")
    b.seek(0)
    return b


def seed():
    now = datetime.now(timezone.utc)
    for uid, tok, adm in ((ADMIN, ATOK, True), (USER, UTOK, False)):
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now}, "$unset": {"outfit": ""}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    h = {"Authorization": f"Bearer {ATOK}"}
    spec = [("character", (240, 200, 160, 255), "body"), ("character", (120, 80, 50, 255), "body"),
            ("top", (220, 20, 20, 255), "rect"), ("top", (20, 20, 220, 255), "rect"),
            ("bottom", (250, 250, 250, 255), "rect"), ("bottom", (20, 160, 20, 255), "rect"),
            ("shoes", (10, 10, 10, 255), "rect"), ("shoes", (250, 200, 0, 255), "rect")]
    ids = []
    for i, (k, c, s) in enumerate(spec):
        files = {"image": (f"{k}{i}.png", png(c, s), "image/png")}
        r = requests.post(f"{BASE}/api/admin/wardrobe", headers=h, data={"kind": k, "name": f"TEST_it22_{k}{i}"}, files=files)
        r.raise_for_status()
        ids.append(f"{k}:{r.json()['item_id']}")
    open(IDS_FILE, "w").write("\n".join(ids))
    players = [p["player_id"] for p in db.players.find({"deleted_at": None}, {"player_id": 1}).limit(3)]
    db.matches.update_one({"match_id": MID}, {"$set": {"match_id": MID, "opponent": "TEST_IT22 FC",
                          "kickoff_at": now - timedelta(minutes=300), "home": True, "competition": "TEST",
                          "final_home": 2, "final_away": 1, "scorer_player_ids": players[:2],
                          "motm_player_id": players[0] if players else None, "created_at": now,
                          "created_by": ADMIN}}, upsert=True)
    print("ids", ids)
    print("players", players)


def clean():
    ids = [x.split(":")[1] for x in open(IDS_FILE).read().split()] if os.path.exists(IDS_FILE) else []
    print("wardrobe", db.wardrobe_items.delete_many({"item_id": {"$in": ids}}).deleted_count)
    for uid in (ADMIN, USER):
        for c in ("users", "user_sessions", "notifications", "scores", "game_sessions", "best_scores"):
            db[c].delete_many({"user_id": uid})
    print("matches", db.matches.delete_many({"match_id": MID}).deleted_count)
    print("predictions", db.predictions.delete_many({"match_id": MID}).deleted_count)


def state():
    print("fresh outfit", (db.users.find_one({"user_id": USER}, {"_id": 0, "outfit": 1}) or {}))
    print("match", db.matches.find_one({"match_id": MID}, {"_id": 0, "final_home": 1, "final_away": 1,
                                                          "scorer_player_ids": 1, "motm_player_id": 1}))
    print("scores", list(db.scores.find({"user_id": {"$in": [ADMIN, USER]}}, {"_id": 0, "mode": 1, "category": 1,
                                                                            "correct": 1, "total": 1, "score": 1})))


{"seed": seed, "clean": clean, "state": state}[sys.argv[1]]()
