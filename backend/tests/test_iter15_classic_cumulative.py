"""Iteration 15: Classic mode CUMULATIVE scoring + leaderboard tests.

Run serially: pytest tests/test_iter15_classic_cumulative.py -n 0
TEST_ users/sessions are created directly in Mongo and removed at teardown.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
_mc = MongoClient(os.environ["MONGO_URL"])
db = _mc[os.environ["DB_NAME"]]


def _mk_user(tag):
    uid = f"TEST_u15_{tag}_{uuid.uuid4().hex[:8]}"
    db.users.insert_one({"user_id": uid, "email": f"{uid.lower()}@example.com", "name": f"TEST_{tag}",
                         "username": f"MU-Q{uuid.uuid4().hex[:5].upper()}", "is_admin": False,
                         "created_at": datetime.now(timezone.utc)})
    tok = f"TEST_tok15_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({"session_token": tok, "user_id": uid,
                                 "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
                                 "created_at": datetime.now(timezone.utc)})
    return uid, tok


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def ctx(base_url):
    tos_before = db.best_scores.find_one({"name": "Tos Joki", "mode": "classic"}, {"_id": 0})
    (a, ta), (b, tb) = _mk_user("a"), _mk_user("b")
    c = {"base": base_url, "a": a, "ta": ta, "b": b, "tb": tb, "sub": {}, "tos": tos_before}
    yield c
    uids = [a, b]
    for col in ("scores", "best_scores", "notifications", "badges"):
        db[col].delete_many({"user_id": {"$in": uids}})
    db.friendships.delete_many({"$or": [{"follower_id": {"$in": uids}}, {"following_id": {"$in": uids}}]})
    db.users.delete_many({"user_id": {"$in": uids}})
    db.user_sessions.delete_many({"session_token": {"$regex": "^TEST_tok15_"}})


def submit(c, tok, score, mode="classic", correct=5, total=10):
    gid = requests.post(f"{c['base']}/api/games/start", headers=H(tok), json={"mode": mode}).json()["game_id"]
    db.game_sessions.update_one({"game_id": gid}, {"$set": {"started_at": datetime.now(timezone.utc) - timedelta(seconds=300)}})
    r = requests.post(f"{c['base']}/api/scores", headers=H(tok),
                      json={"game_id": gid, "score": score, "mode": mode, "category": "all", "correct": correct, "total": total})
    assert r.status_code == 200, r.text
    return r.json()


# --- Classic cumulative submit ---
def test_classic_two_submits_accumulate(ctx):
    r1 = submit(ctx, ctx["ta"], 500, correct=5, total=10)
    r2 = submit(ctx, ctx["ta"], 300, correct=3, total=10)
    assert r1["total_score"] == r1["score"]
    assert r2["total_score"] == r1["score"] + r2["score"]
    if r1["live_bonus"] == 0 and r1["streak_bonus"] == 0 and r2["streak_bonus"] == 0:
        assert r2["total_score"] == 800
    ctx["sub"]["a_total"] = r2["total_score"]
    row = db.best_scores.find_one({"user_id": ctx["a"], "mode": "classic"}, {"_id": 0})
    assert row["score"] == r2["total_score"]
    assert row["games"] == 2 and row["correct"] == 8 and row["total"] == 20


def test_unauth_submit_401(ctx):
    r = requests.post(f"{ctx['base']}/api/scores",
                      json={"score": 1, "mode": "classic", "category": "all", "correct": 1, "total": 1})
    assert r.status_code == 401


# --- Time attack keeps best only ---
def test_time_attack_best_only(ctx):
    r1 = submit(ctx, ctx["ta"], 400, mode="time_attack")
    r2 = submit(ctx, ctx["ta"], 200, mode="time_attack")
    assert r1["total_score"] is None and r2["total_score"] is None
    row = db.best_scores.find_one({"user_id": ctx["a"], "mode": "time_attack"}, {"_id": 0})
    assert row["score"] == r1["score"]
    assert "games" not in row or row.get("games") in (None, 1)


# --- Global leaderboard ranked by accumulated total, reorders live ---
def test_global_leaderboard_sorted_and_realtime(ctx):
    rb = submit(ctx, ctx["tb"], 900)
    lb = requests.get(f"{ctx['base']}/api/leaderboard?mode=classic&limit=200").json()
    scores = [e["score"] for e in lb]
    assert scores == sorted(scores, reverse=True)
    ids = [e["user_id"] for e in lb]
    ea = next(e for e in lb if e["user_id"] == ctx["a"])
    assert ea["games"] == 2 and ea["score"] == ctx["sub"]["a_total"]
    if rb["score"] > ctx["sub"]["a_total"]:
        assert ids.index(ctx["b"]) < ids.index(ctx["a"])
    # A plays one more game -> overtakes B
    r3 = submit(ctx, ctx["ta"], 300)
    ctx["sub"]["a_total"] = r3["total_score"]
    lb2 = requests.get(f"{ctx['base']}/api/leaderboard?mode=classic&limit=200").json()
    ids2 = [e["user_id"] for e in lb2]
    if r3["total_score"] > rb["score"]:
        assert ids2.index(ctx["a"]) < ids2.index(ctx["b"])
    assert next(e for e in lb2 if e["user_id"] == ctx["a"])["games"] == 3


def test_friends_scope_classic(ctx):
    b_user = db.users.find_one({"user_id": ctx["b"]}, {"_id": 0})
    r = requests.post(f"{ctx['base']}/api/friends/follow", headers=H(ctx["ta"]), json={"code": b_user["username"]})
    assert r.status_code == 200, r.text
    lb = requests.get(f"{ctx['base']}/api/leaderboard?mode=classic&scope=friends", headers=H(ctx["ta"])).json()
    ids = {e["user_id"] for e in lb}
    assert ids == {ctx["a"], ctx["b"]}
    assert all("games" in e for e in lb)
    assert lb[0]["score"] >= lb[1]["score"]
    assert requests.get(f"{ctx['base']}/api/leaderboard?mode=classic&scope=friends").json() == []


# --- Weekly ---
def test_weekly_classic_is_sum(ctx):
    lb = requests.get(f"{ctx['base']}/api/leaderboard/weekly?mode=classic&limit=200").json()
    scores = [e["score"] for e in lb]
    assert scores == sorted(scores, reverse=True)
    ea = next(e for e in lb if e["user_id"] == ctx["a"])
    assert ea["games"] == 3 and ea["score"] == ctx["sub"]["a_total"]
    assert ea["correct"] == 13 and ea["total"] == 30
    assert len({e["user_id"] for e in lb}) == len(lb)


def test_weekly_time_attack_best_per_user(ctx):
    lb = requests.get(f"{ctx['base']}/api/leaderboard/weekly?mode=time_attack&limit=200").json()
    rows = [e for e in lb if e["user_id"] == ctx["a"]]
    assert len(rows) == 1
    best = db.best_scores.find_one({"user_id": ctx["a"], "mode": "time_attack"})["score"]
    assert rows[0]["score"] == best


# --- Migration flag ---
def test_migration_flag_present_and_admin_untouched(ctx):
    flag = db.app_settings.find_one({"_key": "migrations"})
    assert flag and flag.get("classic_cumulative_v1") is True
    tos = db.best_scores.find_one({"name": "Tos Joki", "mode": "classic"}, {"_id": 0})
    if ctx["tos"]:
        assert tos["score"] == ctx["tos"]["score"] and tos.get("games") == ctx["tos"].get("games")


# --- Input validation (cumulative total makes this important) ---
def test_negative_score_rejected(ctx):
    r = requests.post(f"{ctx['base']}/api/scores", headers=H(ctx["tb"]),
                      json={"score": -5000, "mode": "classic", "category": "all", "correct": -1, "total": -1})
    assert r.status_code in (400, 422), f"negative score accepted: {r.status_code} {r.text}"
