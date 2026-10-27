"""Seed/cleanup TEST users for iteration 16 frontend E2E. Usage: python seed_iter16_fe.py seed|cleanup|state"""
import os
import sys
from datetime import datetime, timezone, timedelta

import pymongo
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
USERS = [("TEST_fe16_player", "TEST_tok_fe16_player", False), ("TEST_fe16_admin", "TEST_tok_fe16_admin", True)]


def seed():
    for uid, tok, adm in USERS:
        db.users.update_one({"user_id": uid}, {"$set": {
            "user_id": uid, "email": f"{uid}@test.local", "name": uid, "username": uid,
            "is_admin": adm, "created_at": datetime.now(timezone.utc)}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {
            "session_token": tok, "user_id": uid,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc)}}, upsert=True)
    print("seeded")


def cleanup():
    ids = [u[0] for u in USERS]
    for c in ("users", "user_sessions", "scores", "best_scores", "game_sessions", "tournament_boards"):
        r = db[c].delete_many({"user_id": {"$in": ids}})
        print(c, r.deleted_count)


def state():
    uid = USERS[0][0]
    print("best_scores", list(db.best_scores.find({"user_id": uid}, {"_id": 0, "mode": 1, "score": 1, "games": 1})))
    print("scores", db.scores.count_documents({"user_id": uid}))
    print("tickets", list(db.game_sessions.find({"user_id": uid}, {"_id": 0, "mode": 1, "used": 1})))
    print("tboards", list(db.tournament_boards.find({"user_id": uid}, {"_id": 0})))
    s = db.app_settings.find_one({"_key": "public"}, {"_id": 0, "tournament_enabled": 1})
    print("settings", s)


{"seed": seed, "cleanup": cleanup, "state": state}[sys.argv[1]]()
