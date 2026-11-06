"""Iter25 seed/cleanup: TEST admin + TEST normal user sessions; clean TEST_ matches/news created by them.
Usage: python seed_iter25_fe.py seed|clean"""
import os
import sys
from datetime import datetime, timezone, timedelta

import pymongo
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
USERS = [("TEST_it25_admin", "TEST_tok_it25_admin", True), ("TEST_it25_user", "TEST_tok_it25_user", False)]


def seed():
    now = datetime.now(timezone.utc)
    for uid, tok, adm in USERS:
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    print("seeded")


def clean():
    ids = [u[0] for u in USERS]
    m = db.matches.delete_many({"created_by": {"$in": ids}})
    n = db.news.delete_many({"author_id": {"$in": ids}})
    db.user_sessions.delete_many({"session_token": {"$in": [u[1] for u in USERS]}})
    db.users.delete_many({"user_id": {"$in": ids}})
    print("cleaned matches", m.deleted_count, "news", n.deleted_count)


if __name__ == "__main__":
    {"seed": seed, "clean": clean}[sys.argv[1]]()
