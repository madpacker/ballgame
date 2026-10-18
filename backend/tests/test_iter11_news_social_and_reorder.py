"""Iteration 11: news likes/comments + admin quiz-items/reorder.

Follows the same Mongo-seed pattern as iter 10 (test_quiz_items.py):
seeds admin / non-admin users + user_sessions directly in Mongo.
"""
import os
import uuid
import secrets
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import dotenv_values


# ---------- Shared mongo fixture ----------
@pytest.fixture(scope="module")
def mongo_db():
    vals = dotenv_values("/app/backend/.env")
    url = vals.get("MONGO_URL") or os.environ["MONGO_URL"]
    name = vals.get("DB_NAME") or os.environ["DB_NAME"]
    client = MongoClient(url)
    yield client[name]
    client.close()


def _seed_user(mongo_db, is_admin: bool, prefix: str) -> dict:
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:6]}@example.com"
    token = f"TEST_tok_{secrets.token_hex(16)}"
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": f"{prefix} User",
        "picture": None,
        "username": f"MU-{secrets.token_hex(3).upper()}",
        "is_admin": is_admin,
        "created_at": datetime.now(timezone.utc),
    })
    mongo_db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user_id": user_id, "email": email, "token": token}


@pytest.fixture(scope="module")
def admin_bearer(mongo_db):
    u = _seed_user(mongo_db, True, "iter11_admin")
    yield u
    mongo_db.user_sessions.delete_one({"session_token": u["token"]})
    mongo_db.users.delete_one({"user_id": u["user_id"]})
    mongo_db.quiz_items.delete_many({"created_by": u["user_id"]})
    mongo_db.news.delete_many({"author_id": u["user_id"]})


@pytest.fixture(scope="module")
def user_a(mongo_db):
    u = _seed_user(mongo_db, False, "iter11_ua")
    yield u
    mongo_db.user_sessions.delete_one({"session_token": u["token"]})
    mongo_db.users.delete_one({"user_id": u["user_id"]})


@pytest.fixture(scope="module")
def user_b(mongo_db):
    u = _seed_user(mongo_db, False, "iter11_ub")
    yield u
    mongo_db.user_sessions.delete_one({"session_token": u["token"]})
    mongo_db.users.delete_one({"user_id": u["user_id"]})


@pytest.fixture(scope="module")
def news_item(mongo_db, admin_bearer, base_url):
    """Create a news item via admin API."""
    r = requests.post(
        f"{base_url}/api/admin/news",
        headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        data={"title": "TEST_News Iter11", "body": "Body paragraph for iter11."},
    )
    assert r.status_code == 200, r.text
    news_id = r.json()["news_id"]
    yield news_id
    mongo_db.news.delete_one({"news_id": news_id})
    mongo_db.news_likes.delete_many({"news_id": news_id})
    mongo_db.news_comments.delete_many({"news_id": news_id})


# =============== News likes ===============
class TestNewsLikes:
    def test_like_unauth_401(self, base_url, news_item):
        r = requests.post(f"{base_url}/api/news/{news_item}/like")
        assert r.status_code == 401, r.text

    def test_like_toggle(self, base_url, news_item, user_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        # 1st: like
        r = requests.post(f"{base_url}/api/news/{news_item}/like", headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["liked"] is True
        assert d["like_count"] >= 1
        c1 = d["like_count"]
        # GET /news/{id} reflects liked=True + count
        r = requests.get(f"{base_url}/api/news/{news_item}", headers=h)
        assert r.status_code == 200
        g = r.json()
        assert g["liked"] is True
        assert g["like_count"] == c1

        # 2nd: unlike
        r = requests.post(f"{base_url}/api/news/{news_item}/like", headers=h)
        assert r.status_code == 200
        d2 = r.json()
        assert d2["liked"] is False
        assert d2["like_count"] == c1 - 1

        r = requests.get(f"{base_url}/api/news/{news_item}", headers=h)
        assert r.json()["liked"] is False

    def test_like_other_viewer_not_liked(self, base_url, news_item, user_a, user_b):
        # User A likes
        requests.post(
            f"{base_url}/api/news/{news_item}/like",
            headers={"Authorization": f"Bearer {user_a['token']}"},
        )
        # User B viewing sees like_count>=1 but liked=False
        r = requests.get(
            f"{base_url}/api/news/{news_item}",
            headers={"Authorization": f"Bearer {user_b['token']}"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["liked"] is False
        assert d["like_count"] >= 1
        # Unlike to not pollute
        requests.post(
            f"{base_url}/api/news/{news_item}/like",
            headers={"Authorization": f"Bearer {user_a['token']}"},
        )


# =============== News comments ===============
class TestNewsComments:
    def test_comment_unauth_401(self, base_url, news_item):
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments", json={"body": "hi"}
        )
        assert r.status_code == 401

    def test_create_list_newest_first(self, base_url, news_item, user_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r1 = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers=h,
            json={"body": "First comment"},
        )
        assert r1.status_code == 200, r1.text
        c1 = r1.json()
        assert c1["body"] == "First comment"
        assert c1["user_id"] == user_a["user_id"]

        r2 = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers=h,
            json={"body": "Second comment"},
        )
        assert r2.status_code == 200
        c2 = r2.json()

        # List newest first
        lst = requests.get(f"{base_url}/api/news/{news_item}/comments").json()
        ids = [c["comment_id"] for c in lst]
        assert c2["comment_id"] in ids and c1["comment_id"] in ids
        # c2 should come before c1
        assert ids.index(c2["comment_id"]) < ids.index(c1["comment_id"])

        # comment_count on news detail
        g = requests.get(f"{base_url}/api/news/{news_item}").json()
        assert g["comment_count"] >= 2

    def test_delete_as_owner(self, base_url, news_item, user_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers=h,
            json={"body": "to-be-deleted"},
        )
        cid = r.json()["comment_id"]
        d = requests.delete(f"{base_url}/api/news/comments/{cid}", headers=h)
        assert d.status_code == 200, d.text
        assert d.json()["ok"] is True

    def test_delete_as_other_user_403(self, base_url, news_item, user_a, user_b):
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={"body": "owned by A"},
        )
        cid = r.json()["comment_id"]
        d = requests.delete(
            f"{base_url}/api/news/comments/{cid}",
            headers={"Authorization": f"Bearer {user_b['token']}"},
        )
        assert d.status_code == 403, d.text

    def test_delete_as_admin_other_user(self, base_url, news_item, user_a, admin_bearer):
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={"body": "admin will delete"},
        )
        cid = r.json()["comment_id"]
        d = requests.delete(
            f"{base_url}/api/news/comments/{cid}",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert d.status_code == 200

    def test_delete_unauth_401(self, base_url):
        r = requests.delete(f"{base_url}/api/news/comments/nonexistent")
        assert r.status_code == 401

    def test_empty_body_422(self, base_url, news_item, user_a):
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={"body": "   "},
        )
        assert r.status_code == 422


# =============== Quiz items reorder ===============
@pytest.fixture
def trivia_items(mongo_db, admin_bearer, base_url):
    created = []
    h = {"Authorization": f"Bearer {admin_bearer['token']}"}
    for i, label in enumerate(["A", "B", "C"]):
        r = requests.post(
            f"{base_url}/api/admin/quiz-items",
            headers=h,
            data={
                "category": "trivia",
                "prompt": f"TEST_trivia_{label}",
                "option_a": "o1", "option_b": "o2",
                "option_c": "o3", "option_d": "o4",
                "answer_index": 0, "active": "true", "order_index": i,
            },
        )
        assert r.status_code == 200, r.text
        created.append(r.json()["item_id"])
    yield created
    mongo_db.quiz_items.delete_many({"item_id": {"$in": created}})


@pytest.fixture
def garuda_items(mongo_db, admin_bearer, base_url):
    created = []
    h = {"Authorization": f"Bearer {admin_bearer['token']}"}
    for i, label in enumerate(["X", "Y"]):
        r = requests.post(
            f"{base_url}/api/admin/quiz-items",
            headers=h,
            data={
                "category": "garuda",
                "prompt": f"TEST_garuda_{label}",
                "option_a": "o1", "option_b": "o2",
                "option_c": "o3", "option_d": "o4",
                "answer_index": 0, "active": "true", "order_index": i,
            },
        )
        assert r.status_code == 200
        created.append(r.json()["item_id"])
    yield created
    mongo_db.quiz_items.delete_many({"item_id": {"$in": created}})


class TestQuizItemsReorder:
    def test_reorder_unauth_401(self, base_url):
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/reorder",
            json={"category": "trivia", "item_ids": []},
        )
        assert r.status_code == 401

    def test_reorder_nonadmin_403(self, base_url, user_a):
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/reorder",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={"category": "trivia", "item_ids": []},
        )
        assert r.status_code == 403

    def test_reorder_invalid_category_422(self, base_url, admin_bearer):
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/reorder",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            json={"category": "invalid", "item_ids": []},
        )
        assert r.status_code == 422

    def test_reorder_rewrites_order(self, base_url, admin_bearer, trivia_items):
        id1, id2, id3 = trivia_items
        new_order = [id3, id1, id2]
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/reorder",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            json={"category": "trivia", "item_ids": new_order},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["count"] == 3

        # Verify public list order (filtered to our test items)
        g = requests.get(f"{base_url}/api/quiz-items?category=trivia").json()
        ours = [x for x in g if x["item_id"] in trivia_items]
        order_got = [x["item_id"] for x in ours]
        assert order_got == new_order, f"Expected {new_order}, got {order_got}"

    def test_reorder_category_isolation(
        self, base_url, admin_bearer, trivia_items, garuda_items
    ):
        # Capture garuda order BEFORE
        before = requests.get(f"{base_url}/api/quiz-items?category=garuda").json()
        before_ids = [x["item_id"] for x in before if x["item_id"] in garuda_items]

        # Reorder trivia
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/reorder",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            json={"category": "trivia", "item_ids": list(reversed(trivia_items))},
        )
        assert r.status_code == 200

        after = requests.get(f"{base_url}/api/quiz-items?category=garuda").json()
        after_ids = [x["item_id"] for x in after if x["item_id"] in garuda_items]
        assert before_ids == after_ids, "garuda order must not change"


# =============== Regression ===============
class TestIter11Regression:
    def test_app_settings_public(self, base_url):
        r = requests.get(f"{base_url}/api/app-settings")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_news_list_public(self, base_url):
        r = requests.get(f"{base_url}/api/news")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_players_public(self, base_url):
        r = requests.get(f"{base_url}/api/players")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_leaderboard_public(self, base_url):
        r = requests.get(f"{base_url}/api/leaderboard?mode=classic")
        assert r.status_code == 200

    def test_scores_requires_auth(self, base_url):
        r = requests.post(f"{base_url}/api/scores", json={
            "score": 1, "mode": "classic", "category": "all", "correct": 0, "total": 1
        })
        assert r.status_code == 401

    def test_quiz_items_still_public(self, base_url):
        r = requests.get(f"{base_url}/api/quiz-items?category=trivia")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
