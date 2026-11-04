"""Iter19: Profile settings (name/avatar + 7-day cooldown) and Game Store (admin CRUD, redeem with XP balance)."""
import io
import os
from datetime import datetime, timezone, timedelta

import pymongo
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN, ATOK = "TEST_it19_admin", "TEST_tok_it19_admin"
USER, UTOK = "TEST_it19_user", "TEST_tok_it19_user"
POOR, PTOK = "TEST_it19_poor", "TEST_tok_it19_poor"
CREATED = []

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7V\xbd\xfa\x00\x00\x00\x00IEND\xaeB`\x82")


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    for uid, tok, adm in ((ADMIN, ATOK, True), (USER, UTOK, False), (POOR, PTOK, False)):
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    # full doc so /leaderboard (LeaderboardEntry) can still serialize it during the run
    db.best_scores.insert_one({"user_id": USER, "mode": "classic", "score": 1200, "name": USER, "category": "all",
                               "correct": 10, "total": 10, "created_at": now})
    yield
    for cid in CREATED:
        db.store_cards.delete_one({"card_id": cid})
        db.user_cards.delete_many({"card_id": cid})
    for uid in (ADMIN, USER, POOR):
        db.users.delete_many({"user_id": uid})
        db.user_sessions.delete_many({"user_id": uid})
        db.best_scores.delete_many({"user_id": uid})
        db.user_cards.delete_many({"user_id": uid})


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def mk_card(base_url, title="TEST_card", price=500, stock=2, image=True):
    files = {"image": ("c.png", io.BytesIO(PNG), "image/png")} if image else None
    r = requests.post(f"{base_url}/api/admin/store/cards", headers=H(ATOK),
                      data={"title": title, "price": str(price), "stock": str(stock)}, files=files)
    assert r.status_code == 200, r.text
    CREATED.append(r.json()["card_id"])
    return r.json()


# --- Profile settings ---
def test_profile_settings_get(base_url):
    r = requests.get(f"{base_url}/api/me/profile-settings", headers=H(UTOK))
    assert r.status_code == 200
    d = r.json()
    assert d["name"] == USER and d["can_change_photo"] is True and d["next_photo_change_at"] is None


def test_profile_settings_requires_auth(base_url):
    assert requests.get(f"{base_url}/api/me/profile-settings").status_code == 401
    assert requests.put(f"{base_url}/api/me/profile", json={"name": "abc"}).status_code == 401


def test_profile_name_update_and_persist(base_url):
    r = requests.put(f"{base_url}/api/me/profile", json={"name": "  TEST   Nama  Baru "}, headers=H(UTOK))
    assert r.status_code == 200 and r.json()["name"] == "TEST Nama Baru"
    me = requests.get(f"{base_url}/api/auth/me", headers=H(UTOK)).json()
    assert me["name"] == "TEST Nama Baru"
    assert db.users.find_one({"user_id": USER})["custom_name"] is True


@pytest.mark.parametrize("name", ["a", "x" * 31, "   ", " a "])
def test_profile_name_invalid(base_url, name):
    r = requests.put(f"{base_url}/api/me/profile", json={"name": name}, headers=H(UTOK))
    assert r.status_code == 422, (name, r.status_code)


def test_avatar_upload_then_cooldown(base_url):
    r = requests.post(f"{base_url}/api/me/avatar", headers=H(UTOK), files={"image": ("a.png", io.BytesIO(PNG), "image/png")})
    assert r.status_code == 200, r.text
    pic = r.json()["picture"]
    assert pic.startswith("https://") and "/api/files/" in pic
    img = requests.get(pic)
    assert img.status_code == 200 and img.content == PNG
    u = db.users.find_one({"user_id": USER})
    assert u["picture"] == pic and u["custom_picture"] is True
    ps = requests.get(f"{base_url}/api/me/profile-settings", headers=H(UTOK)).json()
    assert ps["can_change_photo"] is False and ps["next_photo_change_at"]
    r2 = requests.post(f"{base_url}/api/me/avatar", headers=H(UTOK), files={"image": ("a.png", io.BytesIO(PNG), "image/png")})
    assert r2.status_code == 429 and r2.json()["detail"] == "photo_cooldown"


def test_avatar_cooldown_expires(base_url):
    db.users.update_one({"user_id": USER}, {"$set": {"avatar_changed_at": datetime.now(timezone.utc) - timedelta(days=8)}})
    ps = requests.get(f"{base_url}/api/me/profile-settings", headers=H(UTOK)).json()
    assert ps["can_change_photo"] is True


def test_avatar_empty_file(base_url):
    r = requests.post(f"{base_url}/api/me/avatar", headers=H(PTOK), files={"image": ("a.png", io.BytesIO(b""), "image/png")})
    assert r.status_code == 400


# --- Store admin CRUD ---
def test_store_admin_auth(base_url):
    assert requests.post(f"{base_url}/api/admin/store/cards", data={"title": "x", "price": "1", "stock": "1"}).status_code == 401
    assert requests.post(f"{base_url}/api/admin/store/cards", headers=H(UTOK), data={"title": "x", "price": "1", "stock": "1"}).status_code == 403
    assert requests.get(f"{base_url}/api/admin/store/cards", headers=H(UTOK)).status_code == 403
    assert requests.put(f"{base_url}/api/admin/store/cards/nope", headers=H(UTOK), data={"price": "1"}).status_code == 403
    assert requests.delete(f"{base_url}/api/admin/store/cards/nope", headers=H(UTOK)).status_code == 403


def test_store_create_list_update_delete(base_url):
    c = mk_card(base_url, "TEST_crud", 300, 5)
    assert c["title"] == "TEST_crud" and c["price"] == 300 and c["stock"] == 5 and c["image_url"].startswith("/api/files/")
    assert requests.get(f"{base_url}{c['image_url']}").status_code == 200
    pub = requests.get(f"{base_url}/api/store/cards").json()
    assert any(x["card_id"] == c["card_id"] for x in pub)
    u = requests.put(f"{base_url}/api/admin/store/cards/{c['card_id']}", headers=H(ATOK), data={"price": "350", "stock": "7", "title": "TEST_crud2"})
    assert u.status_code == 200 and u.json()["price"] == 350 and u.json()["stock"] == 7 and u.json()["title"] == "TEST_crud2"
    adm = requests.get(f"{base_url}/api/admin/store/cards", headers=H(ATOK)).json()
    assert next(x for x in adm if x["card_id"] == c["card_id"])["price"] == 350
    assert requests.put(f"{base_url}/api/admin/store/cards/{c['card_id']}", headers=H(ATOK), data={"price": "-1"}).status_code == 422
    d = requests.delete(f"{base_url}/api/admin/store/cards/{c['card_id']}", headers=H(ATOK))
    assert d.status_code == 200
    assert not any(x["card_id"] == c["card_id"] for x in requests.get(f"{base_url}/api/store/cards").json())
    assert requests.post(f"{base_url}/api/store/cards/{c['card_id']}/redeem", headers=H(UTOK)).status_code == 404
    assert requests.put(f"{base_url}/api/admin/store/cards/{c['card_id']}", headers=H(ATOK), data={"price": "1"}).status_code == 404


def test_store_create_invalid(base_url):
    r = requests.post(f"{base_url}/api/admin/store/cards", headers=H(ATOK), data={"title": " ", "price": "1", "stock": "1"})
    assert r.status_code == 422
    r = requests.post(f"{base_url}/api/admin/store/cards", headers=H(ATOK), data={"title": "TEST_x", "price": "-5", "stock": "1"})
    assert r.status_code == 422


# --- Redeem flows ---
def test_redeem_success_balance_and_level(base_url):
    before = requests.get(f"{base_url}/api/me/xp", headers=H(UTOK)).json()
    assert before["xp"] == 1200 and before["balance"] == 1200 and before["spent"] == 0 and before["level"] == 3
    c = mk_card(base_url, "TEST_redeem", 500, 2)
    r = requests.post(f"{base_url}/api/store/cards/{c['card_id']}/redeem", headers=H(UTOK))
    assert r.status_code == 200 and r.json()["balance"] == 700, r.text
    after = requests.get(f"{base_url}/api/me/xp", headers=H(UTOK)).json()
    assert after["xp"] == 1200 and after["level"] == 3 and after["spent"] == 500 and after["balance"] == 700
    mine = requests.get(f"{base_url}/api/me/cards", headers=H(UTOK)).json()
    assert any(x["card_id"] == c["card_id"] and x["title"] == "TEST_redeem" for x in mine)
    assert next(x for x in requests.get(f"{base_url}/api/store/cards").json() if x["card_id"] == c["card_id"])["stock"] == 1
    # duplicate
    d = requests.post(f"{base_url}/api/store/cards/{c['card_id']}/redeem", headers=H(UTOK))
    assert d.status_code == 409 and d.json()["detail"] == "already_owned"
    assert requests.get(f"{base_url}/api/me/xp", headers=H(UTOK)).json()["balance"] == 700


def test_redeem_insufficient(base_url):
    c = mk_card(base_url, "TEST_expensive", 100000, 3, image=False)
    r = requests.post(f"{base_url}/api/store/cards/{c['card_id']}/redeem", headers=H(PTOK))
    assert r.status_code == 402 and r.json()["detail"] == "insufficient_balance"
    assert requests.get(f"{base_url}/api/me/cards", headers=H(PTOK)).json() == []


def test_redeem_out_of_stock_refunds(base_url):
    c = mk_card(base_url, "TEST_zero", 100, 0, image=False)
    before = requests.get(f"{base_url}/api/me/xp", headers=H(UTOK)).json()["balance"]
    r = requests.post(f"{base_url}/api/store/cards/{c['card_id']}/redeem", headers=H(UTOK))
    assert r.status_code == 410 and r.json()["detail"] == "out_of_stock"
    assert requests.get(f"{base_url}/api/me/xp", headers=H(UTOK)).json()["balance"] == before


def test_redeem_requires_auth(base_url):
    assert requests.post(f"{base_url}/api/store/cards/x/redeem").status_code == 401
    assert requests.get(f"{base_url}/api/me/cards").status_code == 401


def test_redeem_concurrent_double_tap(base_url):
    """Parallel redeems of the same card must result in exactly one ownership and single charge."""
    from concurrent.futures import ThreadPoolExecutor
    c = mk_card(base_url, "TEST_race", 100, 10, image=False)
    before = requests.get(f"{base_url}/api/me/xp", headers=H(UTOK)).json()["balance"]
    with ThreadPoolExecutor(5) as ex:
        codes = list(ex.map(lambda _: requests.post(f"{base_url}/api/store/cards/{c['card_id']}/redeem", headers=H(UTOK)).status_code, range(5)))
    assert codes.count(200) == 1, codes
    assert requests.get(f"{base_url}/api/me/xp", headers=H(UTOK)).json()["balance"] == before - 100
    assert db.store_cards.find_one({"card_id": c["card_id"]})["stock"] == 9
