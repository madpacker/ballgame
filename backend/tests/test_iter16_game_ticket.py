"""Iteration 16: one-time game tickets + score input validation for /api/scores."""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pymongo
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
BASE = "http://localhost:8001"
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture(scope="module")
def tok():
    uid = f"TEST_gt_{uuid.uuid4().hex[:8]}"
    db.users.insert_one({"user_id": uid, "email": f"{uid}@test.local", "name": "GT", "username": uid,
                         "is_admin": False, "created_at": datetime.now(timezone.utc)})
    t = f"TEST_tok_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({"session_token": t, "user_id": uid,
                                 "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
                                 "created_at": datetime.now(timezone.utc)})
    yield {"Authorization": f"Bearer {t}"}, uid
    for c in ("users", "user_sessions", "scores", "best_scores", "game_sessions"):
        db[c].delete_many({"user_id": uid})


def start(h, mode="classic", age=300):
    gid = requests.post(f"{BASE}/api/games/start", headers=h, json={"mode": mode}).json()["game_id"]
    db.game_sessions.update_one({"game_id": gid}, {"$set": {"started_at": datetime.now(timezone.utc) - timedelta(seconds=age)}})
    return gid


def post(h, gid, score=300, correct=3, total=10, mode="classic"):
    return requests.post(f"{BASE}/api/scores", headers=h, json={
        "game_id": gid, "score": score, "mode": mode, "category": "all", "correct": correct, "total": total})


def test_ticket_single_use(tok):
    h, uid = tok
    gid = start(h)
    assert post(h, gid).status_code == 200
    assert post(h, gid).status_code == 409  # reload / duplicate
    row = db.best_scores.find_one({"user_id": uid, "mode": "classic"})
    assert row["games"] == 1


def test_missing_or_fake_ticket(tok):
    h, _ = tok
    r = requests.post(f"{BASE}/api/scores", headers=h, json={
        "score": 100, "mode": "classic", "category": "all", "correct": 1, "total": 10})
    assert r.status_code == 422
    assert post(h, "gm_fake_ticket").status_code == 409


def test_ticket_mode_mismatch(tok):
    h, _ = tok
    gid = start(h, "time_attack")
    assert post(h, gid, mode="classic").status_code == 409


def test_negative_and_inconsistent_rejected(tok):
    h, _ = tok
    assert post(h, start(h), score=-5, correct=0, total=0).status_code == 422
    assert post(h, start(h), score=100, correct=5, total=3).status_code == 422


def test_score_capped_to_correct(tok):
    h, _ = tok
    d = post(h, start(h), score=5000, correct=2, total=10).json()
    assert d["score"] <= 2 * 100 * 2 + 150  # base cap 200 (+streak/live bonus at most)


def test_too_fast_rejected(tok):
    h, _ = tok
    assert post(h, start(h, age=0), score=300, correct=3, total=10).status_code == 422
    assert post(h, start(h, "time_attack", age=10), mode="time_attack").status_code == 422
