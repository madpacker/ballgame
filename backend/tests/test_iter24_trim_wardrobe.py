"""Iter24: transparent-margin trimming on character wardrobe uploads + mascot; outfit PUT with only character_id."""
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
ADMIN, ATOK = "TEST_it24_be_admin", "TEST_tok_it24_be_admin"
USER, UTOK = "TEST_it24_be_user", "TEST_tok_it24_be_user"
AH = {"Authorization": f"Bearer {ATOK}"}
UH = {"Authorization": f"Bearer {UTOK}"}
REAL_ITEMS = {"wd_a68e88cfc7d4", "wd_8bd2e6ec747b"}


def margin_png(w=200, h=400, box=(50, 100, 150, 300)):
    """RGBA PNG with a solid opaque rectangle inside transparent margins."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    im.paste((255, 0, 0, 255), box)
    b = io.BytesIO()
    im.save(b, "PNG")
    b.seek(0)
    return b


def fetch_img(url):
    r = requests.get(f"{BASE}{url}")
    assert r.status_code == 200, r.status_code
    return Image.open(io.BytesIO(r.content))


@pytest.fixture(scope="module", autouse=True)
def sessions():
    now = datetime.now(timezone.utc)
    for uid, tok, adm in ((ADMIN, ATOK, True), (USER, UTOK, False)):
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    prev_mascot = (db.app_settings.find_one({"_key": "public"}) or {}).get("mascot_url")
    created = []
    yield created
    for iid in created:
        assert iid not in REAL_ITEMS
        db.wardrobe_items.delete_one({"item_id": iid})
    for uid in (ADMIN, USER):
        db.users.delete_many({"user_id": uid})
        db.user_sessions.delete_many({"user_id": uid})
        db.user_outfits.delete_many({"user_id": uid}) if "user_outfits" in db.list_collection_names() else None
    db.app_settings.update_one({"_key": "public"}, {"$set": {"mascot_url": prev_mascot}})


# --- Character upload is trimmed ---
class TestCharacterTrim:
    def test_character_trimmed(self, sessions):
        r = requests.post(f"{BASE}/api/admin/wardrobe", headers=AH, data={"kind": "character", "name": "TEST_it24_char"},
                          files={"image": ("c.png", margin_png(), "image/png")})
        assert r.status_code == 200, r.text
        d = r.json()
        sessions.append(d["item_id"])
        assert d["kind"] == "character"
        assert d["image_url"].endswith(".png")
        im = fetch_img(d["image_url"])
        # bbox 100x200 + 2% pad (4px) each side -> 108x208
        assert im.size[0] < 200 and im.size[1] < 400, im.size
        assert 100 <= im.size[0] <= 110 and 200 <= im.size[1] <= 210, im.size

    def test_character_without_margins_untouched(self, sessions):
        r = requests.post(f"{BASE}/api/admin/wardrobe", headers=AH, data={"kind": "character", "name": "TEST_it24_full"},
                          files={"image": ("f.png", margin_png(box=(0, 0, 200, 400)), "image/png")})
        assert r.status_code == 200, r.text
        sessions.append(r.json()["item_id"])
        assert fetch_img(r.json()["image_url"]).size == (200, 400)

    def test_character_jpeg_accepted(self, sessions):
        b = io.BytesIO()
        Image.new("RGB", (120, 240), (0, 120, 255)).save(b, "JPEG")
        b.seek(0)
        r = requests.post(f"{BASE}/api/admin/wardrobe", headers=AH, data={"kind": "character", "name": "TEST_it24_jpg"},
                          files={"image": ("j.jpg", b, "image/jpeg")})
        assert r.status_code == 200, r.text
        sessions.append(r.json()["item_id"])
        assert fetch_img(r.json()["image_url"]).size == (120, 240)

    def test_non_character_not_trimmed(self, sessions):
        r = requests.post(f"{BASE}/api/admin/wardrobe", headers=AH, data={"kind": "top", "name": "TEST_it24_top"},
                          files={"image": ("t.png", margin_png(), "image/png")})
        assert r.status_code == 200, r.text
        sessions.append(r.json()["item_id"])
        assert fetch_img(r.json()["image_url"]).size == (200, 400)

    def test_non_admin_forbidden(self):
        r = requests.post(f"{BASE}/api/admin/wardrobe", headers=UH, data={"kind": "character", "name": "TEST_x"},
                          files={"image": ("c.png", margin_png(), "image/png")})
        assert r.status_code in (401, 403)

    def test_listed_in_wardrobe(self, sessions):
        ids = {i["item_id"] for i in requests.get(f"{BASE}/api/wardrobe").json()}
        assert set(sessions) <= ids
        assert REAL_ITEMS <= ids


# --- Mascot upload is trimmed ---
class TestMascotTrim:
    def test_mascot_trimmed(self):
        r = requests.post(f"{BASE}/api/admin/app-settings/mascot", headers=AH,
                          files={"image": ("m.png", margin_png(300, 300, (100, 50, 200, 250)), "image/png")})
        assert r.status_code == 200, r.text
        url = r.json()["mascot_url"]
        assert url and url.endswith(".png")
        im = fetch_img(url)
        assert im.size[0] < 300 and im.size[1] < 300, im.size
        assert 100 <= im.size[0] <= 110 and 200 <= im.size[1] <= 210
        assert requests.get(f"{BASE}/api/app-settings").json()["mascot_url"] == url


# --- Outfit with only character_id ---
class TestOutfit:
    def test_put_only_character(self, sessions):
        cid = sessions[0]
        r = requests.put(f"{BASE}/api/me/outfit", headers=UH, json={"character_id": cid})
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE}/api/me/outfit", headers=UH).json()
        assert g.get("character_id") == cid
        assert not g.get("top_id") and not g.get("bottom_id") and not g.get("shoes_id")

    def test_put_unauth(self):
        assert requests.put(f"{BASE}/api/me/outfit", json={"character_id": "x"}).status_code == 401
