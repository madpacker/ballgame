"""Helper: python seed_iter15_fe.py create|cleanup  -> TEST_ frontend user + session."""
import os, sys, uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
UID = "TEST_u15_fe"
TOK = "TEST_tok15_fe_session"
if sys.argv[1] == "create":
    db.users.update_one({"user_id": UID}, {"$set": {"user_id": UID, "email": "test_u15_fe@example.com",
                        "name": "TEST_FE15", "username": "MU-TFE15", "is_admin": False,
                        "created_at": datetime.now(timezone.utc)}}, upsert=True)
    db.user_sessions.update_one({"session_token": TOK}, {"$set": {"session_token": TOK, "user_id": UID,
                                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
                                "created_at": datetime.now(timezone.utc)}}, upsert=True)
    print(TOK)
elif sys.argv[1] == "extra":
    for i in range(3):
        u = f"TEST_u15_fe_x{i}"
        db.best_scores.update_one({"user_id": u, "mode": "classic"}, {"$set": {"user_id": u, "name": f"TEST_X{i}",
                                  "mode": "classic", "category": "all", "score": 100 + i, "correct": 4 + i,
                                  "total": 20, "games": 2 + i, "created_at": datetime.now(timezone.utc)}}, upsert=True)
    print("extra rows")
elif sys.argv[1] == "show":
    print(db.best_scores.find_one({"user_id": UID, "mode": "classic"}, {"_id": 0}))
    print(list(db.scores.find({"user_id": UID}, {"_id": 0, "score": 1, "mode": 1})))
else:
    for col in ("scores", "best_scores", "notifications", "badges", "tournament_boards", "royal_events"):
        db[col].delete_many({"user_id": {"$regex": "^TEST_u15_fe"}})
    db.friendships.delete_many({"$or": [{"follower_id": UID}, {"following_id": UID}]})
    db.users.delete_many({"user_id": UID})
    db.user_sessions.delete_many({"session_token": TOK})
    print("cleaned")
