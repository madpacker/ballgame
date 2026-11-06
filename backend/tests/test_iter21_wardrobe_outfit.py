"""Iter21: Dressing Room wardrobe (admin upload/delete) + outfit save/get validation."""
import io
import os
from datetime import datetime, timezone, timedelta

import pymongo
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN, ATOK = "TEST_it21_admin", "TEST_tok_it21_admin"
USER, UTOK = "TEST_it21_user", "TEST_tok_it21_user"
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7V\xbd\xfa\x00\x00\x00\x00IEND\xaeB`\x82")
AH = {"Authorization": f"Bearer {ATOK}"}
UH = {"Authorization": f"Bearer {UTOK}"}
CREATED = []


@pytest.fixture(scope="module", autouse=True)
def users():
    now = datetime.now(timezone.utc)
    for uid, tok, adm in ((ADMIN, ATOK, True), (USER, UTOK, False)):
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    yield
    db.wardrobe_items.delete_many({"item_id": {"$in": CREATED}})
    for uid in (ADMIN, USER):
        db.users.delete_many({"user_id": uid})
        db.user_sessions.delete_many({"user_id": uid})


def _up(kind, h=AH, name=None, back=False):
    files = {"image": ("a.png", io.BytesIO(PNG), "image/png")}
    if back:
        files["back_image"] = ("b.png", io.BytesIO(PNG), "image/png")
    r = requests.post(f"{BASE}/api/admin/wardrobe", headers=h, data={"kind": kind, "name": name or f"TEST_{kind}"}, files=files)
    if r.status_code == 200:
        CREATED.append(r.json()["item_id"])
    return r


# --- wardrobe auth/validation
def test_upload_no_auth_401():
    r = requests.post(f"{BASE}/api/admin/wardrobe", data={"kind": "top"}, files={"image": ("a.png", io.BytesIO(PNG), "image/png")})
    assert r.status_code == 401


def test_upload_non_admin_403():
    assert _up("top", h=UH).status_code == 403


def test_upload_invalid_kind_422():
    r = _up("hat")
    assert r.status_code == 422
    assert "invalid_kind" in r.text


def test_upload_missing_image_422():
    r = requests.post(f"{BASE}/api/admin/wardrobe", headers=AH, data={"kind": "top"})
    assert r.status_code == 422


def test_upload_and_list_with_back():
    r = _up("character", back=True)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == "character" and d["item_id"].startswith("wd_")
    assert d["image_url"].startswith("/api/files/") and d["back_url"].startswith("/api/files/")
    lst = requests.get(f"{BASE}/api/wardrobe").json()
    assert any(i["item_id"] == d["item_id"] and i["back_url"] for i in lst)
    assert all("_id" not in i for i in lst)
    img = requests.get(f"{BASE}{d['image_url']}")
    assert img.status_code == 200 and img.content[:4] == b"\x89PNG"


def test_delete_auth_and_soft():
    iid = _up("shoes").json()["item_id"]
    assert requests.delete(f"{BASE}/api/admin/wardrobe/{iid}").status_code == 401
    assert requests.delete(f"{BASE}/api/admin/wardrobe/{iid}", headers=UH).status_code == 403
    assert requests.delete(f"{BASE}/api/admin/wardrobe/{iid}", headers=AH).status_code == 200
    assert not any(i["item_id"] == iid for i in requests.get(f"{BASE}/api/wardrobe").json())
    assert db.wardrobe_items.find_one({"item_id": iid})["deleted_at"]
    assert requests.delete(f"{BASE}/api/admin/wardrobe/wd_nope", headers=AH).status_code == 404


# --- outfit
def test_outfit_requires_auth():
    assert requests.get(f"{BASE}/api/me/outfit").status_code == 401
    assert requests.put(f"{BASE}/api/me/outfit", json={}).status_code == 401


def test_outfit_empty_default():
    r = requests.get(f"{BASE}/api/me/outfit", headers=UH)
    assert r.status_code == 200 and r.json() == {}


def test_outfit_save_and_get():
    ch = _up("character").json()["item_id"]
    top = _up("top").json()["item_id"]
    bot = _up("bottom").json()["item_id"]
    sh = _up("shoes").json()["item_id"]
    body = {"character_id": ch, "top_id": top, "bottom_id": bot, "shoes_id": sh}
    r = requests.put(f"{BASE}/api/me/outfit", headers=UH, json=body)
    assert r.status_code == 200 and r.json() == body
    assert requests.get(f"{BASE}/api/me/outfit", headers=UH).json() == body
    # partial save drops unset fields
    r = requests.put(f"{BASE}/api/me/outfit", headers=UH, json={"character_id": ch})
    assert r.json() == {"character_id": ch}


def test_outfit_wrong_kind_422():
    top = _up("top").json()["item_id"]
    r = requests.put(f"{BASE}/api/me/outfit", headers=UH, json={"character_id": top})
    assert r.status_code == 422 and "invalid_character_id" in r.text


def test_outfit_unknown_id_422():
    r = requests.put(f"{BASE}/api/me/outfit", headers=UH, json={"shoes_id": "wd_doesnotexist"})
    assert r.status_code == 422 and "invalid_shoes_id" in r.text


def test_outfit_deleted_item_422():
    iid = _up("bottom").json()["item_id"]
    requests.delete(f"{BASE}/api/admin/wardrobe/{iid}", headers=AH)
    r = requests.put(f"{BASE}/api/me/outfit", headers=UH, json={"bottom_id": iid})
    assert r.status_code == 422
