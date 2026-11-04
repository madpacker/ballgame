# Iter17: inspect migration state (players -> trivia) and match/admin data (read-only)
import os
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

print("migration flag:", db.app_settings.find_one({"_key": "migrations"}, {"_id": 0}))
mig = list(db.quiz_items.find({"source_player_id": {"$exists": True}}, {"_id": 0}))
print("migrated items:", len(mig))
players = {p["player_id"]: p for p in db.players.find({}, {"_id": 0})}
eligible = [p for p in players.values() if not p.get("deleted_at") and p.get("photo_url") and p.get("included_in_quiz") is not False]
print("eligible players:", len(eligible), "total players:", len(players))
bad = 0
src = {}
for it in mig:
    src[it["source_player_id"]] = src.get(it["source_player_id"], 0) + 1
    p = players.get(it["source_player_id"])
    ok = (
        it["category"] == "trivia" and len(it["options"]) == 4 and len(set(it["options"])) == 4
        and p is not None and it["options"][it["answer_index"]] == p["name"]
        and it.get("image_url") == p.get("photo_url") and it["prompt"] == "Siapa pemain Madura United ini?"
    )
    if not ok:
        bad += 1
        print("BAD:", it)
print("bad items:", bad, "duplicate sources:", [k for k, v in src.items() if v > 1])
for c in ["trivia", "garuda", "liga", "bali", "persebaya", "persib", "persija", "guess", "history"]:
    print(c, db.quiz_items.count_documents({"category": c, "deleted_at": {"$exists": False}, "active": True}))
print("admins:", [(u.get("name"), u.get("user_id")) for u in db.users.find({"is_admin": True}, {"_id": 0})])
print("app_settings public keys:", list((db.app_settings.find_one({"_key": "public"}, {"_id": 0}) or {}).keys()))
print("category_logos:", (db.app_settings.find_one({"_key": "public"}, {"_id": 0}) or {}).get("category_logos"))
