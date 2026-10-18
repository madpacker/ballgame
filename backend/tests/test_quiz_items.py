"""Iteration 10: /api/quiz-items (public + admin) for Trivia Klub & Garuda Call.

Seeds admin / non-admin users directly in Mongo (same pattern as iter 9).
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


@pytest.fixture(scope="module")
def admin_bearer(mongo_db):
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"TEST_qi_admin_{uuid.uuid4().hex[:6]}@example.com"
    token = f"TEST_tok_{secrets.token_hex(16)}"
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "QI Admin",
        "picture": None,
        "username": f"MU-{secrets.token_hex(3).upper()}",
        "is_admin": True,
        "created_at": datetime.now(timezone.utc),
    })
    mongo_db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    yield {"user_id": user_id, "email": email, "token": token}
    mongo_db.user_sessions.delete_one({"session_token": token})
    mongo_db.users.delete_one({"user_id": user_id})
    mongo_db.quiz_items.delete_many({"created_by": user_id})


@pytest.fixture(scope="module")
def nonadmin_bearer(mongo_db):
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"TEST_qi_user_{uuid.uuid4().hex[:6]}@example.com"
    token = f"TEST_tok_{secrets.token_hex(16)}"
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "QI User",
        "picture": None,
        "username": f"MU-{secrets.token_hex(3).upper()}",
        "is_admin": False,
        "created_at": datetime.now(timezone.utc),
    })
    mongo_db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    yield {"user_id": user_id, "token": token}
    mongo_db.user_sessions.delete_one({"session_token": token})
    mongo_db.users.delete_one({"user_id": user_id})


def _tiny_png() -> bytes:
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082"
    )


# ---------- Public GET /api/quiz-items ----------
class TestQuizItemsPublic:
    def test_public_list_trivia_no_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/quiz-items?category=trivia")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_public_list_garuda_no_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/quiz-items?category=garuda")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_public_list_invalid_category_422(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/quiz-items?category=all")
        assert r.status_code == 422, r.text
        assert r.json().get("detail") == "invalid_category"

    def test_public_list_missing_category(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/quiz-items")
        # FastAPI returns 422 for missing required query param
        assert r.status_code == 422, r.text


# ---------- Admin auth gating ----------
class TestQuizItemsAuthGating:
    def test_admin_list_without_auth_401(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/admin/quiz-items?category=trivia")
        assert r.status_code == 401, r.text

    def test_admin_list_nonadmin_403(self, api_client, base_url, nonadmin_bearer):
        r = api_client.get(
            f"{base_url}/api/admin/quiz-items?category=trivia",
            headers={"Authorization": f"Bearer {nonadmin_bearer['token']}"},
        )
        assert r.status_code == 403, r.text
        assert r.json().get("detail") == "admin_only"

    def test_admin_create_without_auth_401(self, api_client, base_url):
        s = api_client
        s.headers.pop("Content-Type", None)
        r = s.post(
            f"{base_url}/api/admin/quiz-items",
            data={
                "category": "trivia",
                "prompt": "p",
                "option_a": "a",
                "option_b": "b",
                "option_c": "c",
                "option_d": "d",
                "answer_index": "0",
            },
        )
        assert r.status_code == 401, r.text

    def test_admin_create_nonadmin_403(self, api_client, base_url, nonadmin_bearer):
        s = api_client
        s.headers.pop("Content-Type", None)
        r = s.post(
            f"{base_url}/api/admin/quiz-items",
            data={
                "category": "trivia",
                "prompt": "p",
                "option_a": "a",
                "option_b": "b",
                "option_c": "c",
                "option_d": "d",
                "answer_index": "0",
            },
            headers={"Authorization": f"Bearer {nonadmin_bearer['token']}"},
        )
        assert r.status_code == 403, r.text

    def test_admin_update_without_auth_401(self, api_client, base_url):
        r = api_client.put(f"{base_url}/api/admin/quiz-items/qi_fake", json={"active": False})
        assert r.status_code == 401, r.text

    def test_admin_delete_without_auth_401(self, api_client, base_url):
        r = api_client.delete(f"{base_url}/api/admin/quiz-items/qi_fake")
        assert r.status_code == 401, r.text


# ---------- Full lifecycle ----------
class TestQuizItemsLifecycle:
    created_ids: list[str] = []

    @classmethod
    def teardown_class(cls):
        # best-effort cleanup done per-fixture, but also via test cleanup fixture
        pass

    def test_create_trivia_item_with_image(self, api_client, base_url, admin_bearer, mongo_db):
        s = api_client
        s.headers.pop("Content-Type", None)
        data = {
            "category": "trivia",
            "prompt": "TEST trivia prompt",
            "option_a": "AA",
            "option_b": "BB",
            "option_c": "CC",
            "option_d": "DD",
            "answer_index": "2",
        }
        files = {"image": ("x.png", _tiny_png(), "image/png")}
        r = s.post(
            f"{base_url}/api/admin/quiz-items",
            data=data,
            files=files,
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["category"] == "trivia"
        assert body["prompt"] == "TEST trivia prompt"
        assert body["options"] == ["AA", "BB", "CC", "DD"]
        assert body["answer_index"] == 2
        assert body["active"] is True
        assert body["image_url"] and body["image_url"].startswith("/api/files/")
        assert "item_id" in body and body["item_id"].startswith("qi_")
        TestQuizItemsLifecycle.created_ids.append(body["item_id"])

        # verify public GET returns it
        r2 = api_client.get(f"{base_url}/api/quiz-items?category=trivia")
        assert r2.status_code == 200
        ids = [it["item_id"] for it in r2.json()]
        assert body["item_id"] in ids

    def test_create_garuda_item_no_image(self, api_client, base_url, admin_bearer):
        s = api_client
        s.headers.pop("Content-Type", None)
        data = {
            "category": "garuda",
            "prompt": "TEST garuda prompt",
            "option_a": "G1",
            "option_b": "G2",
            "option_c": "G3",
            "option_d": "G4",
            "answer_index": "0",
        }
        r = s.post(
            f"{base_url}/api/admin/quiz-items",
            data=data,
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["category"] == "garuda"
        assert body["image_url"] is None
        TestQuizItemsLifecycle.created_ids.append(body["item_id"])

    def test_create_invalid_answer_index(self, api_client, base_url, admin_bearer):
        s = api_client
        s.headers.pop("Content-Type", None)
        r = s.post(
            f"{base_url}/api/admin/quiz-items",
            data={
                "category": "trivia",
                "prompt": "p",
                "option_a": "a",
                "option_b": "b",
                "option_c": "c",
                "option_d": "d",
                "answer_index": "5",
            },
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert r.status_code == 422, r.text
        assert r.json().get("detail") == "invalid_answer_index"

    def test_category_isolation_public(self, api_client, base_url):
        """Only trivia items returned for trivia filter, only garuda for garuda."""
        rt = api_client.get(f"{base_url}/api/quiz-items?category=trivia")
        rg = api_client.get(f"{base_url}/api/quiz-items?category=garuda")
        assert rt.status_code == 200 and rg.status_code == 200
        for it in rt.json():
            assert it["category"] == "trivia"
        for it in rg.json():
            assert it["category"] == "garuda"

    def test_update_active_hides_public(self, api_client, base_url, admin_bearer):
        assert TestQuizItemsLifecycle.created_ids, "need created item"
        item_id = TestQuizItemsLifecycle.created_ids[0]
        s = api_client
        s.headers["Content-Type"] = "application/json"
        r = s.put(
            f"{base_url}/api/admin/quiz-items/{item_id}",
            json={"active": False},
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["active"] is False
        # public GET should NOT return it
        r2 = api_client.get(f"{base_url}/api/quiz-items?category=trivia")
        ids = [it["item_id"] for it in r2.json()]
        assert item_id not in ids
        # admin GET SHOULD still return it
        r3 = api_client.get(
            f"{base_url}/api/admin/quiz-items?category=trivia",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert r3.status_code == 200
        admin_ids = [it["item_id"] for it in r3.json()]
        assert item_id in admin_ids

    def test_update_invalid_options_length(self, api_client, base_url, admin_bearer):
        item_id = TestQuizItemsLifecycle.created_ids[0]
        s = api_client
        s.headers["Content-Type"] = "application/json"
        r = s.put(
            f"{base_url}/api/admin/quiz-items/{item_id}",
            json={"options": ["a", "b", "c"]},
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert r.status_code == 422, r.text
        assert r.json().get("detail") == "invalid_options"

    def test_update_invalid_answer_index(self, api_client, base_url, admin_bearer):
        item_id = TestQuizItemsLifecycle.created_ids[0]
        s = api_client
        s.headers["Content-Type"] = "application/json"
        r = s.put(
            f"{base_url}/api/admin/quiz-items/{item_id}",
            json={"answer_index": 5},
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert r.status_code == 422, r.text
        assert r.json().get("detail") == "invalid_answer_index"

    def test_replace_image(self, api_client, base_url, admin_bearer):
        item_id = TestQuizItemsLifecycle.created_ids[0]
        s = api_client
        s.headers.pop("Content-Type", None)
        # First get current URL
        s.headers["Content-Type"] = "application/json"
        g = s.put(
            f"{base_url}/api/admin/quiz-items/{item_id}",
            json={"active": True},
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert g.status_code == 200
        prev_url = g.json().get("image_url")
        # Upload new image
        s.headers.pop("Content-Type", None)
        files = {"image": ("new.png", _tiny_png(), "image/png")}
        r = s.post(
            f"{base_url}/api/admin/quiz-items/{item_id}/image",
            files=files,
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert r.status_code == 200, r.text
        new_url = r.json()["image_url"]
        assert new_url and new_url != prev_url
        # Verify file downloadable
        path = new_url.replace("/api/files/", "")
        d = api_client.get(f"{base_url}/api/files/{path}")
        assert d.status_code == 200
        assert len(d.content) > 0

    def test_delete_soft_removes(self, api_client, base_url, admin_bearer):
        item_id = TestQuizItemsLifecycle.created_ids[-1]
        s = api_client
        s.headers.pop("Content-Type", None)
        r = s.delete(
            f"{base_url}/api/admin/quiz-items/{item_id}",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert r.status_code == 200, r.text
        # not in admin or public anymore
        rp = api_client.get(f"{base_url}/api/quiz-items?category=garuda")
        assert item_id not in [it["item_id"] for it in rp.json()]
        ra = api_client.get(
            f"{base_url}/api/admin/quiz-items?category=garuda",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        )
        assert ra.status_code == 200
        assert item_id not in [it["item_id"] for it in ra.json()]


# ---------- Regression: previously tested endpoints still work ----------
class TestPrevRegression:
    def test_app_settings_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/app-settings")
        assert r.status_code == 200
        body = r.json()
        assert "background_url" in body and "socials" in body

    def test_news_list_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/news")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_leaderboard_classic(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard?mode=classic")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_players_list_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/players")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_scores_requires_auth(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/scores",
            json={"score": 10, "mode": "classic", "category": "all", "correct": 1, "total": 1},
        )
        assert r.status_code == 401
