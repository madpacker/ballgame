"""Iter23: lobby mascot app-setting + wardrobe back-image endpoints (admin-only)."""
import io
import os
from datetime import datetime, timezone, timedelta

import pymongo
import pytest
import requests
from dotenv import load_dotenv
from PIL import Image

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN, ATOK = "TEST_it23_be_admin", "TEST_tok_it23_be_admin"
USER, UTOK = "TEST_it23_be_user", "TEST_tok_it23_be_user"
AH = {"Authorization": f"Bearer {ATOK}"}
UH = {"Authorization": f"Bearer {UTOK}"}


def png(color=(255, 0, 0, 255)):
    b = io.BytesIO()
    Image.new("RGBA", (40, 80), color).save(b, "PNG")
    b.seek(0)
    return b


@pytest.fixture(scope="module", autouse=True)
def sessions():
    now = datetime.now(timezone.utc)
    for uid, tok, adm in ((ADMIN, ATOK, True), (USER, UTOK, False)):
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    prev_mascot = (db.app_settings.find_one({"_key": "public"}) or {}).get("mascot_url")
    yield
    for uid in (ADMIN, USER):
        db.users.delete_many({"user_id": uid})
        db.user_sessions.delete_many({"user_id": uid})
    db.app_settings.update_one({"_key": "public"}, {"$set": {"mascot_url": prev_mascot}})


@pytest.fixture(scope="module")
def item():
    r = requests.post(f"{BASE}/api/admin/wardrobe", headers=AH, data={"kind": "top", "name": "TEST_it23_top"},
                      files={"image": ("t.png", png(), "image/png")})
    assert r.status_code == 200, r.text
    iid = r.json()["item_id"]
    yield r.json()
    db.wardrobe_items.delete_one({"item_id": iid})


# --- Mascot ---
class TestMascot:
    def test_mascot_upload_non_admin_forbidden(self):
        r = requests.post(f"{BASE}/api/admin/app-settings/mascot", headers=UH, files={"image": ("m.png", png(), "image/png")})
        assert r.status_code in (401, 403)

    def test_mascot_upload_no_auth(self):
        r = requests.post(f"{BASE}/api/admin/app-settings/mascot", files={"image": ("m.png", png(), "image/png")})
        assert r.status_code in (401, 403)

    def test_mascot_upload_get_delete(self):
        r = requests.post(f"{BASE}/api/admin/app-settings/mascot", headers=AH, files={"image": ("m.png", png(), "image/png")})
        assert r.status_code == 200, r.text
        url = r.json()["mascot_url"]
        assert url and url.startswith("/api/files/")
        g = requests.get(f"{BASE}/api/app-settings").json()
        assert g["mascot_url"] == url
        f = requests.get(f"{BASE}{url}")
        assert f.status_code == 200 and len(f.content) > 0
        d = requests.delete(f"{BASE}/api/admin/app-settings/mascot", headers=AH)
        assert d.status_code == 200 and d.json()["mascot_url"] is None
        assert requests.get(f"{BASE}/api/app-settings").json()["mascot_url"] is None

    def test_mascot_delete_non_admin(self):
        r = requests.delete(f"{BASE}/api/admin/app-settings/mascot", headers=UH)
        assert r.status_code in (401, 403)

    def test_mascot_empty_image(self):
        r = requests.post(f"{BASE}/api/admin/app-settings/mascot", headers=AH, files={"image": ("m.png", b"", "image/png")})
        assert r.status_code in (400, 422)


# --- Wardrobe back image ---
class TestWardrobeBack:
    def test_set_back_and_list(self, item):
        r = requests.post(f"{BASE}/api/admin/wardrobe/{item['item_id']}/back", headers=AH,
                          files={"image": ("b.png", png((0, 0, 255, 255)), "image/png")})
        assert r.status_code == 200, r.text
        bu = r.json()["back_url"]
        assert bu and bu.startswith("/api/files/") and r.json()["image_url"] == item["image_url"]
        lst = requests.get(f"{BASE}/api/wardrobe").json()
        m = [x for x in lst if x["item_id"] == item["item_id"]]
        assert m and m[0]["back_url"] == bu
        assert requests.get(f"{BASE}{bu}").status_code == 200

    def test_clear_back(self, item):
        r = requests.delete(f"{BASE}/api/admin/wardrobe/{item['item_id']}/back", headers=AH)
        assert r.status_code == 200 and r.json().get("back_url") is None
        m = [x for x in requests.get(f"{BASE}/api/wardrobe").json() if x["item_id"] == item["item_id"]]
        assert m and m[0].get("back_url") is None

    def test_back_unknown_404(self):
        r = requests.post(f"{BASE}/api/admin/wardrobe/wd_TEST_nope/back", headers=AH, files={"image": ("b.png", png(), "image/png")})
        assert r.status_code == 404
        assert requests.delete(f"{BASE}/api/admin/wardrobe/wd_TEST_nope/back", headers=AH).status_code == 404

    def test_back_non_admin(self, item):
        r = requests.post(f"{BASE}/api/admin/wardrobe/{item['item_id']}/back", headers=UH, files={"image": ("b.png", png(), "image/png")})
        assert r.status_code in (401, 403)
        assert requests.delete(f"{BASE}/api/admin/wardrobe/{item['item_id']}/back", headers=UH).status_code in (401, 403)

    def test_create_with_back_image(self):
        r = requests.post(f"{BASE}/api/admin/wardrobe", headers=AH, data={"kind": "character", "name": "TEST_it23_char"},
                          files={"image": ("c.png", png(), "image/png"), "back_image": ("cb.png", png((0, 255, 0, 255)), "image/png")})
        assert r.status_code == 200, r.text
        j = r.json()
        try:
            assert j["back_url"] and j["back_url"] != j["image_url"]
        finally:
            db.wardrobe_items.delete_one({"item_id": j["item_id"]})
