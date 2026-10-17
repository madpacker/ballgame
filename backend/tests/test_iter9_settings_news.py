"""Iteration 9: app-settings (background/socials/description) + news admin CRUD.

Seeds an admin user + bearer token directly in Mongo so we don't need
Google OAuth for backend testing. Each test class cleans up after itself.
"""
import io
import os
import uuid
import secrets
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path
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
    """Create an admin user + session token directly in Mongo."""
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"TEST_iter9_admin_{uuid.uuid4().hex[:6]}@example.com"
    token = f"TEST_tok_{secrets.token_hex(16)}"
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "Iter9 Admin",
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
    # cleanup
    mongo_db.user_sessions.delete_one({"session_token": token})
    mongo_db.users.delete_one({"user_id": user_id})
    mongo_db.news.delete_many({"author_id": user_id})


@pytest.fixture(scope="module")
def nonadmin_bearer(mongo_db):
    """Create a non-admin user + token."""
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"TEST_iter9_user_{uuid.uuid4().hex[:6]}@example.com"
    token = f"TEST_tok_{secrets.token_hex(16)}"
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "Iter9 User",
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


def _tiny_png_bytes() -> bytes:
    # 1x1 transparent PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082"
    )


# ---------- App Settings ----------
class TestAppSettingsPublic:
    def test_get_app_settings_public_no_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/app-settings")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "background_url" in data
        assert "description" in data
        assert "socials" in data
        s = data["socials"]
        for k in ("instagram", "tiktok", "whatsapp", "youtube"):
            assert k in s, f"missing social key: {k}"


class TestAppSettingsAdminGate:
    def test_put_app_settings_without_auth(self, api_client, base_url):
        r = api_client.put(f"{base_url}/api/admin/app-settings", json={"description": "x"})
        assert r.status_code in (401, 403)

    def test_put_app_settings_with_invalid_bearer(self, api_client, base_url):
        r = api_client.put(
            f"{base_url}/api/admin/app-settings",
            json={"description": "x"},
            headers={"Authorization": "Bearer bogus"},
        )
        assert r.status_code in (401, 403)

    def test_put_app_settings_nonadmin_forbidden(self, api_client, base_url, nonadmin_bearer):
        r = api_client.put(
            f"{base_url}/api/admin/app-settings",
            json={"description": "x"},
            headers={"Authorization": f"Bearer {nonadmin_bearer['token']}"},
        )
        assert r.status_code == 403, r.text

    def test_post_background_without_auth(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/admin/app-settings/background",
            files={"image": ("x.png", _tiny_png_bytes(), "image/png")},
        )
        assert r.status_code in (401, 403)

    def test_delete_background_without_auth(self, api_client, base_url):
        r = api_client.delete(f"{base_url}/api/admin/app-settings/background")
        assert r.status_code in (401, 403)

    def test_delete_background_nonadmin_forbidden(self, api_client, base_url, nonadmin_bearer):
        r = api_client.delete(
            f"{base_url}/api/admin/app-settings/background",
            headers={"Authorization": f"Bearer {nonadmin_bearer['token']}"},
        )
        assert r.status_code == 403


class TestAppSettingsAdminFlow:
    def test_put_description_and_socials(self, api_client, base_url, admin_bearer):
        payload = {
            "description": "TEST_Iter9 Cak Mad admin",
            "socials": {
                "instagram": "https://instagram.com/testiter9",
                "tiktok": "https://tiktok.com/@testiter9",
                "whatsapp": "+628123456789",
                "youtube": "https://youtube.com/@testiter9",
            },
        }
        r = requests.put(
            f"{base_url}/api/admin/app-settings",
            json=payload,
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["description"] == payload["description"]
        for k, v in payload["socials"].items():
            assert got["socials"][k] == v

        # GET reflects it
        r2 = requests.get(f"{base_url}/api/app-settings", timeout=15)
        assert r2.status_code == 200
        got2 = r2.json()
        assert got2["description"] == payload["description"]
        assert got2["socials"]["instagram"] == payload["socials"]["instagram"]

    def test_upload_background_and_fetch(self, api_client, base_url, admin_bearer):
        r = requests.post(
            f"{base_url}/api/admin/app-settings/background",
            files={"image": ("bg.png", _tiny_png_bytes(), "image/png")},
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        got = r.json()
        assert got["background_url"], "background_url empty after upload"
        assert got["background_url"].startswith("/api/files/"), got["background_url"]

        # Public GET reflects
        r2 = requests.get(f"{base_url}/api/app-settings", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["background_url"] == got["background_url"]

        # Serve file bytes
        file_rel = got["background_url"][len("/api"):]  # /files/...
        r3 = requests.get(f"{base_url}/api{file_rel}", timeout=30)
        assert r3.status_code == 200, r3.text
        assert len(r3.content) > 0
        assert r3.headers.get("Content-Type", "").startswith("image/")

    def test_delete_background_clears(self, api_client, base_url, admin_bearer):
        r = requests.delete(
            f"{base_url}/api/admin/app-settings/background",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["background_url"] is None
        r2 = requests.get(f"{base_url}/api/app-settings", timeout=15)
        assert r2.json()["background_url"] is None


# ---------- News ----------
class TestNewsPublic:
    def test_news_list_public_no_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/news")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_news_detail_nonexistent_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/news/nw_nonexistent")
        assert r.status_code == 404


class TestNewsAdminGate:
    def test_create_news_without_auth(self, api_client, base_url):
        r = requests.post(
            f"{base_url}/api/admin/news",
            data={"title": "x", "body": "y"},
            timeout=20,
        )
        assert r.status_code in (401, 403)

    def test_create_news_invalid_bearer(self, api_client, base_url):
        r = requests.post(
            f"{base_url}/api/admin/news",
            data={"title": "x", "body": "y"},
            headers={"Authorization": "Bearer bogus"},
            timeout=20,
        )
        assert r.status_code in (401, 403)

    def test_create_news_nonadmin_forbidden(self, api_client, base_url, nonadmin_bearer):
        r = requests.post(
            f"{base_url}/api/admin/news",
            data={"title": "x", "body": "y"},
            headers={"Authorization": f"Bearer {nonadmin_bearer['token']}"},
            timeout=20,
        )
        assert r.status_code == 403

    def test_update_news_without_auth(self, api_client, base_url):
        r = requests.put(f"{base_url}/api/admin/news/nw_fake", json={"title": "x"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_delete_news_without_auth(self, api_client, base_url):
        r = requests.delete(f"{base_url}/api/admin/news/nw_fake", timeout=15)
        assert r.status_code in (401, 403)


class TestNewsAdminFlow:
    def test_create_update_delete_news_flow(self, api_client, base_url, admin_bearer):
        hdr = {"Authorization": f"Bearer {admin_bearer['token']}"}
        long_body = (
            "TEST_Iter9: Madura United memperpanjang kontrak striker andalan menjelang laga pekan depan. "
            * 5
        )
        r = requests.post(
            f"{base_url}/api/admin/news",
            data={"title": "TEST_Iter9 Berita Baru", "body": long_body},
            files={"cover": ("cover.png", _tiny_png_bytes(), "image/png")},
            headers=hdr,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["title"] == "TEST_Iter9 Berita Baru"
        assert d["body"].startswith("TEST_Iter9")
        assert d["excerpt"] and len(d["excerpt"]) <= 161  # 160 + ellipsis
        assert d["cover_url"] and d["cover_url"].startswith("/api/files/")
        news_id = d["news_id"]

        # List public contains it
        r2 = requests.get(f"{base_url}/api/news", timeout=15)
        assert r2.status_code == 200
        assert any(x["news_id"] == news_id for x in r2.json())

        # Detail public
        r3 = requests.get(f"{base_url}/api/news/{news_id}", timeout=15)
        assert r3.status_code == 200
        assert r3.json()["body"] == long_body.strip()

        # Update
        new_body = "TEST_Iter9 updated body: match report tomorrow."
        r4 = requests.put(
            f"{base_url}/api/admin/news/{news_id}",
            json={"title": "TEST_Iter9 Updated", "body": new_body},
            headers=hdr,
            timeout=20,
        )
        assert r4.status_code == 200, r4.text
        upd = r4.json()
        assert upd["title"] == "TEST_Iter9 Updated"
        assert upd["body"] == new_body
        assert upd["excerpt"].startswith("TEST_Iter9 updated body")

        # Delete (soft)
        r5 = requests.delete(f"{base_url}/api/admin/news/{news_id}", headers=hdr, timeout=20)
        assert r5.status_code == 200
        assert r5.json()["ok"] is True

        # List no longer includes
        r6 = requests.get(f"{base_url}/api/news", timeout=15)
        assert all(x["news_id"] != news_id for x in r6.json())

        # Detail 404
        r7 = requests.get(f"{base_url}/api/news/{news_id}", timeout=15)
        assert r7.status_code == 404

    def test_create_news_missing_fields_422(self, api_client, base_url, admin_bearer):
        hdr = {"Authorization": f"Bearer {admin_bearer['token']}"}
        r = requests.post(
            f"{base_url}/api/admin/news",
            data={"title": "   ", "body": "   "},
            headers=hdr,
            timeout=15,
        )
        assert r.status_code == 422
