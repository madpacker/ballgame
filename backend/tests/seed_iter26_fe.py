"""Iter26 seed/cleanup: TEST admin + TEST normal user sessions for leagues/score-prediction tests.
Usage: python seed_iter26_fe.py seed|clean"""
import os
import sys
from datetime import datetime, timezone, timedelta

import pymongo
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
USERS = [("TEST_it26_admin", "TEST_tok_it26_admin", True), ("TEST_it26_user", "TEST_tok_it26_user", False)]


def seed():
    now = datetime.now(timezone.utc)
    for uid, tok, adm in USERS:
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now, "onboarded": True}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    print("seeded")


def clean():
    ids = [u[0] for u in USERS]
    mids = [m["match_id"] for m in db.matches.find({"created_by": {"$in": ids}}, {"match_id": 1})]
    p = db.predictions.delete_many({"$or": [{"match_id": {"$in": mids}}, {"user_id": {"$in": ids}}]})
    m = db.matches.delete_many({"match_id": {"$in": mids}})
    t = db.team_logos.delete_many({"key": {"$regex": "^test_it26"}})
    db.notifications.delete_many({"user_id": {"$in": ids}})
    db.user_sessions.delete_many({"session_token": {"$in": [u[1] for u in USERS]}})
    db.users.delete_many({"user_id": {"$in": ids}})
    print("cleaned matches", m.deleted_count, "preds", p.deleted_count, "logos", t.deleted_count)


if __name__ == "__main__":
    {"seed": seed, "clean": clean}[sys.argv[1]]()
