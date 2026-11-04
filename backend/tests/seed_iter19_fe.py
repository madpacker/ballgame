"""Seed/cleanup for iter19 FE tests. Usage: python seed_iter19_fe.py seed|clean"""
import os
import sys
from datetime import datetime, timezone, timedelta

import pymongo
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
USERS = [("TEST_it19fe_admin", "TEST_tok_it19fe_admin", True, 1500), ("TEST_it19fe_cool", "TEST_tok_it19fe_cool", False, 100)]

if sys.argv[1] == "seed":
    now = datetime.now(timezone.utc)
    for uid, tok, adm, xp in USERS:
        doc = {"user_id": uid, "email": f"{uid}@test.local", "name": "TEST Ifan", "username": uid, "is_admin": adm, "created_at": now}
        if not adm:
            doc["avatar_changed_at"] = now - timedelta(days=1)
        db.users.update_one({"user_id": uid}, {"$set": doc}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
        db.best_scores.update_one({"user_id": uid, "mode": "classic"}, {"$set": {"score": xp, "name": "TEST Ifan", "category": "all", "correct": 10, "total": 10, "created_at": now}}, upsert=True)
    print("seeded")
else:
    ids = [u[0] for u in USERS]
    cards = [c["card_id"] for c in db.store_cards.find({"title": {"$regex": "^TEST_it19fe"}}, {"card_id": 1})]
    db.store_cards.delete_many({"card_id": {"$in": cards}})
    db.user_cards.delete_many({"$or": [{"card_id": {"$in": cards}}, {"user_id": {"$in": ids}}]})
    for coll in ("users", "user_sessions", "best_scores", "scores", "game_sessions"):
        db[coll].delete_many({"user_id": {"$in": ids}})
    print("cleaned", cards)
