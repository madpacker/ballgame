"""Iter17 FE seed: TEST admin + finished-without-score TEST match. Usage: python seed_iter17_fe.py seed|cleanup|state"""
import os
import sys
from datetime import datetime, timezone, timedelta

import pymongo
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
UID, TOK, MID = "TEST_fe17_admin", "TEST_tok_fe17_admin", "mt_TEST_fe17"


def seed():
    now = datetime.now(timezone.utc)
    db.users.update_one({"user_id": UID}, {"$set": {"user_id": UID, "email": f"{UID}@test.local", "name": UID,
                        "username": UID, "is_admin": True, "created_at": now}}, upsert=True)
    db.user_sessions.update_one({"session_token": TOK}, {"$set": {"session_token": TOK, "user_id": UID,
                                "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    db.matches.update_one({"match_id": MID}, {"$set": {"match_id": MID, "opponent": "TEST_FE17 United",
                          "kickoff_at": now - timedelta(minutes=300), "home": True, "competition": "TEST",
                          "final_home": None, "final_away": None, "created_at": now, "created_by": UID}}, upsert=True)
    print("seeded")


def cleanup():
    print("users", db.users.delete_many({"user_id": UID}).deleted_count)
    print("sessions", db.user_sessions.delete_many({"user_id": UID}).deleted_count)
    print("matches", db.matches.delete_many({"match_id": MID}).deleted_count)
    print("quiz_items", db.quiz_items.delete_many({"created_by": UID}).deleted_count)


def state():
    print("match", db.matches.find_one({"match_id": MID}, {"_id": 0, "final_home": 1, "final_away": 1}))
    print("items", list(db.quiz_items.find({"created_by": UID}, {"_id": 0, "category": 1, "prompt": 1, "answer_index": 1, "options": 1})))
    print("logos", (db.app_settings.find_one({"_key": "public"}, {"_id": 0}) or {}).get("category_logos"))
    print("tournament", (db.app_settings.find_one({"_key": "public"}, {"_id": 0}) or {}).get("tournament_enabled"))


{"seed": seed, "cleanup": cleanup, "state": state}[sys.argv[1]]()
