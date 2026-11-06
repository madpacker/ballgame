"""Iter21 FE seed/cleanup: TEST admin+user sessions + wardrobe items. Usage: python seed_iter21_fe.py seed|clean"""
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
ADMIN, ATOK = "TEST_it21fe_admin", "TEST_tok_it21fe_admin"
USER, UTOK = "TEST_it21fe_user", "TEST_tok_it21fe_user"
IDS_FILE = "/tmp/it21_wardrobe_ids.txt"


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
                            "username": uid, "is_admin": adm, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    h = {"Authorization": f"Bearer {ATOK}"}
    spec = [("character", (240, 200, 160, 255), "body", True), ("character", (120, 80, 50, 255), "body", False),
            ("top", (220, 20, 20, 255), "rect", False), ("top", (20, 20, 220, 255), "rect", False),
            ("bottom", (250, 250, 250, 255), "rect", False), ("shoes", (10, 10, 10, 255), "rect", False)]
    ids = []
    for i, (k, c, s, back) in enumerate(spec):
        files = {"image": (f"{k}{i}.png", png(c, s), "image/png")}
        if back:
            files["back_image"] = ("back.png", png((0, 200, 0, 255), s), "image/png")
        r = requests.post(f"{BASE}/api/admin/wardrobe", headers=h, data={"kind": k, "name": f"TEST_{k}{i}"}, files=files)
        r.raise_for_status()
        ids.append(r.json()["item_id"])
        print(k, r.json()["item_id"])
    open(IDS_FILE, "w").write("\n".join(ids))


def clean():
    ids = open(IDS_FILE).read().split() if os.path.exists(IDS_FILE) else []
    db.wardrobe_items.delete_many({"item_id": {"$in": ids}})
    for uid in (ADMIN, USER):
        for c in ("users", "user_sessions", "notifications"):
            db[c].delete_many({"user_id": uid})
    print("cleaned", ids)


if __name__ == "__main__":
    seed() if sys.argv[1] == "seed" else clean()
