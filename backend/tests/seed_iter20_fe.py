"""Iter20 FE seed/cleanup: TEST admin+user sessions, 9 F100 items, 1 store card. Usage: python seed_iter20_fe.py seed|clean"""
import io
import os
import sys
from datetime import datetime, timezone, timedelta

import pymongo
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN, ATOK = "TEST_it20fe_admin", "TEST_tok_it20fe_admin"
USER, UTOK = "TEST_it20fe_user", "TEST_tok_it20fe_user"
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7V\xbd\xfa\x00\x00\x00\x00IEND\xaeB`\x82")


def seed():
    now = datetime.now(timezone.utc)
    for uid, tok, adm in ((ADMIN, ATOK, True), (USER, UTOK, False)):
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    h = {"Authorization": f"Bearer {ATOK}"}
    for i in range(9):
        r = requests.post(f"{BASE}/api/admin/f100/items", headers=h, json={
            "prompt": f"TEST_fe Q{i} urutkan 4", "answers": [f"Ans{i}-1", f"Ans{i}-2", f"Ans{i}-3", f"Ans{i}-4"],
            "wrong": [f"Wr{i}-1", f"Wr{i}-2", f"Wr{i}-3", f"Wr{i}-4"], "active": True})
        r.raise_for_status()
    r = requests.post(f"{BASE}/api/admin/store/cards", headers=h, data={"title": "TEST_fe_card", "price": "999", "stock": "3"},
                      files={"image": ("c.png", io.BytesIO(PNG), "image/png")})
    r.raise_for_status()
    print("card", r.json()["card_id"])


def clean():
    ids = [d["item_id"] for d in db.f100_items.find({"prompt": {"$regex": "^TEST_fe"}})]
    db.f100_items.delete_many({"item_id": {"$in": ids}})
    cids = [d["card_id"] for d in db.store_cards.find({"title": "TEST_fe_card"})]
    db.store_cards.delete_many({"card_id": {"$in": cids}})
    db.user_cards.delete_many({"card_id": {"$in": cids}})
    for uid in (ADMIN, USER):
        for c in ("users", "user_sessions", "f100_board", "f100_sessions", "notifications", "user_cards"):
            db[c].delete_many({"user_id": uid})
    db.tournament_archives.delete_many({"reset_by": ADMIN})
    db.app_settings.update_one({"_key": "public"}, {"$set": {"tournament_enabled": False, "tournament_categories":
                               sorted(["trivia", "garuda", "liga", "bali", "persebaya", "persib", "persija"])}})
    print("cleaned", len(ids), cids)


if __name__ == "__main__":
    seed() if sys.argv[1] == "seed" else clean()
