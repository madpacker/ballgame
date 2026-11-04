"""Iter18 FE seed: TEST admin (with XP 840 -> LV2 340/500) + finished TEST match with scorers/MOTM. Usage: seed|cleanup|state"""
import os
import sys
from datetime import datetime, timezone, timedelta

import pymongo
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
UID, TOK, MID = "TEST_fe18_admin", "TEST_tok_fe18_admin", "mt_TEST_fe18"
SC, MOTM = "pl_26fc6719e4c7", "pl_5801b0aaaab2"


def seed():
    now = datetime.now(timezone.utc)
    db.users.update_one({"user_id": UID}, {"$set": {"user_id": UID, "email": f"{UID}@test.local", "name": "Test Lobby Admin",
                        "username": UID, "is_admin": True, "created_at": now}}, upsert=True)
    db.user_sessions.update_one({"session_token": TOK}, {"$set": {"session_token": TOK, "user_id": UID,
                                "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    db.best_scores.update_one({"user_id": UID, "mode": "classic"}, {"$set": {"score": 840, "name": "Test Lobby Admin",
                              "picture": None, "category": "trivia", "correct": 84, "total": 90, "games": 9, "created_at": now, "updated_at": now}}, upsert=True)
    db.matches.update_one({"match_id": MID}, {"$set": {"match_id": MID, "opponent": "TEST_FE18 United",
                          "kickoff_at": now - timedelta(minutes=300), "home": True, "competition": "TEST",
                          "final_home": 2, "final_away": 1, "scorer_player_ids": [SC], "motm_player_id": MOTM,
                          "created_at": now, "created_by": UID}}, upsert=True)
    print("seeded")


def cleanup():
    for c in ("users", "user_sessions", "best_scores", "scores", "game_sessions", "predictions", "notifications"):
        print(c, db[c].delete_many({"user_id": UID}).deleted_count)
    print("matches", db.matches.delete_many({"match_id": MID}).deleted_count)


def state():
    print("match", db.matches.find_one({"match_id": MID}, {"_id": 0, "final_home": 1, "final_away": 1, "scorer_player_ids": 1, "motm_player_id": 1}))
    print("scores", list(db.scores.find({"user_id": UID}, {"_id": 0})))
    print("best", list(db.best_scores.find({"user_id": UID}, {"_id": 0})))


{"seed": seed, "cleanup": cleanup, "state": state}[sys.argv[1]]()
