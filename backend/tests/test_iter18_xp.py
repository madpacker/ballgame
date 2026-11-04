"""Iter18: GET /api/me/xp (level/XP from all modes) + classic short-category submit."""
import os
import time
from datetime import datetime, timezone, timedelta

import pymongo
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
UID, TOK = "TEST_it18_xp", "TEST_tok_it18_xp"
UID2, TOK2 = "TEST_it18_empty", "TEST_tok_it18_empty"


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    for uid, tok in ((UID, TOK), (UID2, TOK2)):
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": False, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    yield
    for uid in (UID, UID2):
        db.users.delete_many({"user_id": uid})
        db.user_sessions.delete_many({"user_id": uid})
        db.best_scores.delete_many({"user_id": uid})
        db.scores.delete_many({"user_id": uid})
        db.tournament_boards.delete_many({"user_id": uid})
        db.predictions.delete_many({"user_id": uid})
        db.game_sessions.delete_many({"user_id": uid})


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# XP: auth required
def test_xp_requires_auth(base_url):
    r = requests.get(f"{base_url}/api/me/xp")
    assert r.status_code == 401


# XP: new user has zero xp, level 1
def test_xp_empty_user(base_url):
    r = requests.get(f"{base_url}/api/me/xp", headers=H(TOK2))
    assert r.status_code == 200
    assert r.json() == {"xp": 0, "level": 1, "level_xp": 0, "level_size": 500, "spent": 0, "balance": 0,
                        "best": {"classic": 0, "time_attack": 0}}


# XP: sums best_scores + tournament classic/time_attack boards + positive prediction points
def test_xp_sums_all_sources(base_url):
    db.best_scores.insert_many([
        {"user_id": UID, "mode": "classic", "score": 400},
        {"user_id": UID, "mode": "time_attack", "score": 250},
    ])
    db.tournament_boards.insert_many([
        {"user_id": UID, "board": "classic", "score": 100},
        {"user_id": UID, "board": "time_attack", "score": 50},
        {"user_id": UID, "board": "royal", "score": 9999},  # must be ignored
    ])
    db.predictions.insert_many([
        {"user_id": UID, "match_id": "TEST_m1", "points": 40},
        {"user_id": UID, "match_id": "TEST_m2", "points": 0},
        {"user_id": UID, "match_id": "TEST_m3", "points": None},
    ])
    r = requests.get(f"{base_url}/api/me/xp", headers=H(TOK))
    assert r.status_code == 200
    d = r.json()
    assert d["xp"] == 840, d
    assert d["level"] == 2 and d["level_xp"] == 340 and d["level_size"] == 500


# Classic short category: total=1 played honestly in ~1.5s is accepted
def test_classic_total1_submit_ok(base_url):
    g = requests.post(f"{base_url}/api/games/start", json={"mode": "classic"}, headers=H(TOK2))
    assert g.status_code == 200
    time.sleep(1.5)
    r = requests.post(f"{base_url}/api/scores", headers=H(TOK2), json={
        "score": 10, "mode": "classic", "category": "trivia", "correct": 1, "total": 1,
        "game_id": g.json()["game_id"]})
    assert r.status_code == 200, r.text
    x = requests.get(f"{base_url}/api/me/xp", headers=H(TOK2)).json()
    assert x["xp"] >= 10


# Classic with total=10 submitted instantly is still rejected
def test_classic_total10_too_fast(base_url):
    g = requests.post(f"{base_url}/api/games/start", json={"mode": "classic"}, headers=H(TOK2))
    r = requests.post(f"{base_url}/api/scores", headers=H(TOK2), json={
        "score": 100, "mode": "classic", "category": "trivia", "correct": 10, "total": 10,
        "game_id": g.json()["game_id"]})
    assert r.status_code == 422 and "game_too_fast" in r.text
