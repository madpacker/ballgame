"""Iteration 14: Tournament mode (Classic / Time Attack / Royal) backend tests.

Sessions are created directly in Mongo for an existing admin + TEST_ non-admin users.
NOTE: stateful (shared tournament toggle) -> run serially: pytest tests/test_iter14_tournament.py -n 0
All test data is cleaned up and tournament_enabled restored to its original value at the end.
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


def _mk_session(user_id):
    tok = f"TEST_tok_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({"session_token": tok, "user_id": user_id,
                                 "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
                                 "created_at": datetime.now(timezone.utc)})
    return tok


def _mk_user(tag):
    uid = f"TEST_u_{tag}_{uuid.uuid4().hex[:8]}"
    db.users.insert_one({"user_id": uid, "email": f"{uid}@example.com", "name": f"TEST_{tag}",
                         "username": f"MU-T{uuid.uuid4().hex[:5].upper()}", "is_admin": False,
                         "created_at": datetime.now(timezone.utc)})
    return uid


@pytest.fixture(scope="module")
def ctx(base_url):
    admin = db.users.find_one({"is_admin": True}, {"_id": 0})
    if not admin:
        pytest.skip("no admin user")
    orig = bool((db.app_settings.find_one({"_key": "public"}) or {}).get("tournament_enabled", False))
    u1, u2, u3 = _mk_user("a"), _mk_user("b"), _mk_user("c")
    news_ids = []
    for i in range(6):
        nid = f"TEST_nw_{uuid.uuid4().hex[:10]}"
        db.news.insert_one({"news_id": nid, "title": f"TEST news {i}", "body": "TEST body", "excerpt": "TEST",
                            "cover_url": None, "author_id": u1, "author_name": "TEST_a",
                            "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)})
        news_ids.append(nid)
    c = {"admin": admin, "atok": _mk_session(admin["user_id"]), "u1": u1, "u2": u2, "u3": u3,
         "t1": _mk_session(u1), "t2": _mk_session(u2), "t3": _mk_session(u3), "news": news_ids,
         "base": base_url, "orig": orig}
    yield c
    uids = [u1, u2, u3]
    db.app_settings.update_one({"_key": "public"}, {"$set": {"tournament_enabled": orig}})
    db.tournament_boards.delete_many({"user_id": {"$in": uids}})
    db.royal_events.delete_many({"user_id": {"$in": uids}})
    db.royal_videos.delete_many({"user_id": {"$in": uids}})
    db.scores.delete_many({"user_id": {"$in": uids}})
    db.best_scores.delete_many({"user_id": {"$in": uids}})
    db.notifications.delete_many({"user_id": {"$in": uids}})
    db.news_likes.delete_many({"news_id": {"$in": news_ids}})
    db.news_comments.delete_many({"news_id": {"$in": news_ids}})
    db.news.delete_many({"news_id": {"$in": news_ids}})
    db.users.delete_many({"user_id": {"$in": uids}})
    db.user_sessions.delete_many({"session_token": {"$regex": "^TEST_tok_"}})


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def toggle(c, enabled):
    r = requests.put(f"{c['base']}/api/admin/tournament", json={"enabled": enabled}, headers=H(c["atok"]))
    assert r.status_code == 200, r.text
    assert r.json() == {"enabled": enabled}


def score(c, tok, mode, sc, correct, total):
    gid = requests.post(f"{c['base']}/api/games/start", headers=H(tok), json={"mode": mode}).json().get("game_id", "none")
    db.game_sessions.update_one({"game_id": gid}, {"$set": {"started_at": datetime.now(timezone.utc) - timedelta(seconds=300)}})
    return requests.post(f"{c['base']}/api/scores", headers=H(tok),
                         json={"game_id": gid, "score": sc, "mode": mode, "category": "tournament", "correct": correct, "total": total})


# ---------- Status / toggle ----------
class TestToggle:
    def test_toggle_auth(self, ctx):
        b = ctx["base"]
        assert requests.put(f"{b}/api/admin/tournament", json={"enabled": True}).status_code == 401
        assert requests.put(f"{b}/api/admin/tournament", json={"enabled": True}, headers=H(ctx["t1"])).status_code == 403

    def test_toggle_reflects_in_status_and_settings(self, ctx):
        b = ctx["base"]
        toggle(ctx, False)
        assert requests.get(f"{b}/api/tournament/status").json() == {"enabled": False}
        assert requests.get(f"{b}/api/app-settings").json().get("tournament_enabled") is False
        toggle(ctx, True)
        assert requests.get(f"{b}/api/tournament/status").json() == {"enabled": True}
        assert requests.get(f"{b}/api/app-settings").json().get("tournament_enabled") is True


# ---------- Disabled behaviour ----------
class TestClosed:
    def test_closed_scores_videos_likes(self, ctx):
        toggle(ctx, False)
        for m in ("t_classic", "t_time_attack"):
            r = score(ctx, ctx["t3"], m, 100, 1, 20)
            assert r.status_code == 403 and r.json()["detail"] == "tournament_closed"
        r = requests.post(f"{ctx['base']}/api/royal/videos", headers=H(ctx["t3"]), json={"url": "https://youtu.be/abc"})
        assert r.status_code == 403
        r = requests.post(f"{ctx['base']}/api/news/{ctx['news'][5]}/like", headers=H(ctx["t3"]))
        assert r.status_code == 200 and r.json()["liked"] is True and r.json()["royal_awarded"] == 0
        me = requests.get(f"{ctx['base']}/api/tournament/me", headers=H(ctx["t3"])).json()
        assert me["enabled"] is False and me["royal_points"] == 0
        toggle(ctx, True)


# ---------- Scores ----------
class TestScores:
    def test_classic_cumulative_and_cap(self, ctx):
        toggle(ctx, True)
        r = score(ctx, ctx["t1"], "t_classic", 1500, 10, 20)
        d = r.json()
        assert r.status_code == 200, r.text
        assert d["board"] == "classic" and d["board_score"] == 1500 and d["rank"] >= 1 and d["royal_awarded"] == 10
        d2 = score(ctx, ctx["t1"], "t_classic", 9999, 5, 50).json()  # capped to 5*200
        assert d2["score"] == 1000 and d2["board_score"] == 2500

    def test_classic_total_capped_20(self, ctx):
        d = score(ctx, ctx["t1"], "t_classic", 10000, 30, 30).json()
        assert d["score"] == 4000  # correct capped to 20 -> 20*200
        row = db.tournament_boards.find_one({"board": "classic", "user_id": ctx["u1"]})
        assert row["score"] == 6500 and row["games"] == 3 and row["total"] == 60
        # 4th classic play -> royal limit 3/day reached
        d4 = score(ctx, ctx["t1"], "t_classic", 0, 0, 20).json()
        assert d4["royal_awarded"] == 0

    def test_time_attack_best_only(self, ctx):
        d = score(ctx, ctx["t2"], "t_time_attack", 800, 8, 10).json()
        assert d["board"] == "time_attack" and d["board_score"] == 800 and d["new_best"] is True and d["royal_awarded"] == 5
        d = score(ctx, ctx["t2"], "t_time_attack", 500, 5, 6).json()
        assert d["board_score"] == 800 and d["new_best"] is False
        d = score(ctx, ctx["t2"], "t_time_attack", 5000, 12, 15).json()  # capped 1200
        assert d["score"] == 1200 and d["board_score"] == 1200 and d["new_best"] is True
        d = score(ctx, ctx["t2"], "t_time_attack", 100, 1, 1).json()
        assert d["royal_awarded"] == 0  # 4th play

    def test_not_in_normal_leaderboard(self, ctx):
        for m in ("classic", "time_attack"):
            lb = requests.get(f"{ctx['base']}/api/leaderboard?mode={m}&limit=200").json()
            assert all(e["user_id"] not in (ctx["u1"], ctx["u2"]) for e in lb)
        assert db.best_scores.count_documents({"user_id": {"$in": [ctx["u1"], ctx["u2"]]}}) == 0


# ---------- Leaderboard ----------
class TestLeaderboard:
    def test_boards_sorted(self, ctx):
        for b in ("classic", "time_attack", "royal"):
            r = requests.get(f"{ctx['base']}/api/tournament/leaderboard?board={b}")
            assert r.status_code == 200
            s = [e["score"] for e in r.json()]
            assert s == sorted(s, reverse=True)
        cl = requests.get(f"{ctx['base']}/api/tournament/leaderboard?board=classic").json()
        assert any(e["user_id"] == ctx["u1"] and e["score"] == 6500 for e in cl)

    def test_invalid_board(self, ctx):
        assert requests.get(f"{ctx['base']}/api/tournament/leaderboard?board=xyz").status_code == 422


# ---------- Royal missions ----------
class TestRoyal:
    def test_like_limits_and_no_farming(self, ctx):
        b, t = ctx["base"], ctx["t2"]
        n0 = ctx["news"][0]
        assert requests.post(f"{b}/api/news/{n0}/like", headers=H(t)).json()["royal_awarded"] == 5
        assert requests.post(f"{b}/api/news/{n0}/like", headers=H(t)).json()["liked"] is False  # unlike
        assert requests.post(f"{b}/api/news/{n0}/like", headers=H(t)).json()["royal_awarded"] == 0  # relike
        got = [requests.post(f"{b}/api/news/{n}/like", headers=H(t)).json()["royal_awarded"] for n in ctx["news"][1:6]]
        assert got == [5, 5, 5, 5, 0]

    def test_comment_limit(self, ctx):
        b, t = ctx["base"], ctx["t2"]
        for i in range(4):
            r = requests.post(f"{b}/api/news/{ctx['news'][0]}/comments", headers=H(t), json={"body": f"TEST comment {i}"})
            assert r.status_code == 200, r.text
        ev = db.royal_events.count_documents({"user_id": ctx["u2"], "mission": "comment_news"})
        assert ev == 3

    def test_me(self, ctx):
        me = requests.get(f"{ctx['base']}/api/tournament/me", headers=H(ctx["t2"])).json()
        m = {x["key"]: x for x in me["missions"]}
        assert m["like_news"]["done_today"] == 5 and m["comment_news"]["done_today"] == 3
        assert m["play_time_attack"]["done_today"] == 3 and m["play_classic"]["done_today"] == 0
        # 25 like + 30 comment + 15 TA
        assert me["royal_points"] == 70 and me["boards"]["royal"]["score"] == 70
        assert me["boards"]["time_attack"]["score"] == 1200
        assert requests.get(f"{ctx['base']}/api/tournament/me").status_code == 401


# ---------- Videos ----------
class TestVideos:
    def test_submit_validation_and_review(self, ctx):
        b, t, a = ctx["base"], ctx["t1"], ctx["atok"]
        assert requests.post(f"{b}/api/royal/videos", headers=H(t), json={"url": "notaurl"}).status_code == 422
        r = requests.post(f"{b}/api/royal/videos", headers=H(t), json={"url": "https://youtu.be/TEST1", "caption": "TEST"})
        assert r.status_code == 200 and r.json()["status"] == "pending"
        vid = r.json()["video_id"]
        assert requests.post(f"{b}/api/royal/videos", headers=H(t), json={"url": "https://youtu.be/TEST2"}).status_code == 429
        assert requests.get(f"{b}/api/admin/royal/videos?status=pending", headers=H(t)).status_code == 403
        assert requests.get(f"{b}/api/admin/royal/videos?status=pending").status_code == 401
        pend = requests.get(f"{b}/api/admin/royal/videos?status=pending", headers=H(a)).json()
        assert any(v["video_id"] == vid for v in pend)
        before = requests.get(f"{b}/api/tournament/me", headers=H(t)).json()["royal_points"]
        r = requests.post(f"{b}/api/admin/royal/videos/{vid}/review", headers=H(a), json={"approve": True})
        assert r.status_code == 200 and r.json()["status"] == "approved"
        after = requests.get(f"{b}/api/tournament/me", headers=H(t)).json()
        assert after["royal_points"] == before + 20
        assert after["videos"][0]["status"] == "approved"
        assert db.notifications.count_documents({"user_id": ctx["u1"], "type": "royal_video"}) >= 1 or \
            db.notifications.count_documents({"user_id": ctx["u1"]}) >= 1
        assert requests.post(f"{b}/api/admin/royal/videos/{vid}/review", headers=H(a), json={"approve": False}).status_code == 409
        assert requests.post(f"{b}/api/admin/royal/videos/rv_nope/review", headers=H(a), json={"approve": True}).status_code == 404

    def test_reject_gives_zero(self, ctx):
        b, t, a = ctx["base"], ctx["t3"], ctx["atok"]
        toggle(ctx, True)
        vid = requests.post(f"{b}/api/royal/videos", headers=H(t), json={"url": "https://tiktok.com/@x/TEST"}).json()["video_id"]
        r = requests.post(f"{b}/api/admin/royal/videos/{vid}/review", headers=H(a), json={"approve": False})
        assert r.status_code == 200 and r.json()["status"] == "rejected"
        me = requests.get(f"{b}/api/tournament/me", headers=H(t)).json()
        assert me["royal_points"] == 0
        # rejected doesn't count towards the daily limit -> can resubmit
        assert requests.post(f"{b}/api/royal/videos", headers=H(t), json={"url": "https://youtu.be/TEST3"}).status_code == 200
