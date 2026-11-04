"""Iter20: Football 100 (admin CRUD/import, start/submit scoring, cumulative board, XP), admin gift Futcards,
tournament reset + tournament categories toggle."""
import io
import os
from datetime import datetime, timezone, timedelta

import pymongo
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN, ATOK = "TEST_it20_admin", "TEST_tok_it20_admin"
USER, UTOK = "TEST_it20_user", "TEST_tok_it20_user"
ITEMS, CARDS = [], []
ALL_CATS = sorted(["trivia", "garuda", "liga", "bali", "persebaya", "persib", "persija"])

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7V\xbd\xfa\x00\x00\x00\x00IEND\xaeB`\x82")


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    now = datetime.now(timezone.utc)
    for uid, tok, adm in ((ADMIN, ATOK, True), (USER, UTOK, False)):
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    yield
    db.f100_items.delete_many({"item_id": {"$in": ITEMS}})
    db.f100_items.delete_many({"prompt": {"$regex": "^TEST_it20_csv"}})
    for cid in CARDS:
        db.store_cards.delete_one({"card_id": cid})
        db.user_cards.delete_many({"card_id": cid})
    for uid in (ADMIN, USER):
        db.users.delete_many({"user_id": uid})
        db.user_sessions.delete_many({"user_id": uid})
        db.f100_board.delete_many({"user_id": uid})
        db.f100_sessions.delete_many({"user_id": uid})
        db.notifications.delete_many({"user_id": uid})
        db.tournament_boards.delete_many({"user_id": uid})
    db.tournament_archives.delete_many({"reset_by": ADMIN})
    db.app_settings.update_one({"_key": "public"}, {"$set": {"tournament_enabled": False,
                                                              "tournament_categories": ALL_CATS}})


def item(i):
    return {"prompt": f"TEST_it20 Q{i} order 4 clubs", "answers": [f"A{i}1", f"A{i}2", f"A{i}3", f"A{i}4"],
            "wrong": [f"W{i}1", f"W{i}2", f"W{i}3", f"W{i}4"], "active": True}


# --- F100 admin ---
def test_f100_admin_auth(base_url):
    assert requests.get(f"{base_url}/api/admin/f100/items").status_code == 401
    assert requests.get(f"{base_url}/api/admin/f100/items", headers=H(UTOK)).status_code == 403
    assert requests.post(f"{base_url}/api/admin/f100/items", headers=H(UTOK), json=item(0)).status_code == 403


def test_f100_validation(base_url):
    bad = item(0); bad["wrong"][0] = "a01"  # duplicate (case-insensitive)
    r = requests.post(f"{base_url}/api/admin/f100/items", headers=H(ATOK), json=bad)
    assert r.status_code == 422 and r.json()["detail"] == "need_8_unique_options"
    bad2 = item(0); bad2["answers"] = ["x", "y", "z"]
    assert requests.post(f"{base_url}/api/admin/f100/items", headers=H(ATOK), json=bad2).status_code == 422
    bad3 = item(0); bad3["wrong"][1] = "  "
    assert requests.post(f"{base_url}/api/admin/f100/items", headers=H(ATOK), json=bad3).status_code == 422


def test_f100_create_update_delete(base_url):
    for i in range(10):
        r = requests.post(f"{base_url}/api/admin/f100/items", headers=H(ATOK), json=item(i))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["answers"] == item(i)["answers"] and d["item_id"].startswith("f1_")
        ITEMS.append(d["item_id"])
    upd = item(0); upd["prompt"] = "TEST_it20 Q0 edited"
    r = requests.put(f"{base_url}/api/admin/f100/items/{ITEMS[0]}", headers=H(ATOK), json=upd)
    assert r.status_code == 200 and r.json()["prompt"] == "TEST_it20 Q0 edited"
    lst = requests.get(f"{base_url}/api/admin/f100/items", headers=H(ATOK)).json()
    assert any(x["item_id"] == ITEMS[0] and x["prompt"] == "TEST_it20 Q0 edited" for x in lst)
    # extra item then delete
    r = requests.post(f"{base_url}/api/admin/f100/items", headers=H(ATOK), json=item(99))
    xid = r.json()["item_id"]; ITEMS.append(xid)
    assert requests.delete(f"{base_url}/api/admin/f100/items/{xid}", headers=H(ATOK)).status_code == 200
    lst = requests.get(f"{base_url}/api/admin/f100/items", headers=H(ATOK)).json()
    assert all(x["item_id"] != xid for x in lst)
    assert requests.delete(f"{base_url}/api/admin/f100/items/nope", headers=H(ATOK)).status_code == 404
    assert requests.put(f"{base_url}/api/admin/f100/items/nope", headers=H(ATOK), json=item(1)).status_code == 404


def test_f100_csv_import(base_url):
    csv_txt = ("prompt,answer_1,answer_2,answer_3,answer_4,wrong_1,wrong_2,wrong_3,wrong_4,active\n"
               "TEST_it20_csv good,a,b,c,d,e,f,g,h,false\n"
               "TEST_it20_csv dup,a,a,c,d,e,f,g,h,true\n"
               ",a,b,c,d,e,f,g,h,true\n")
    r = requests.post(f"{base_url}/api/admin/f100/import", headers=H(ATOK),
                      files={"file": ("f.csv", io.BytesIO(csv_txt.encode()), "text/csv")})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["created"] == 1 and d["skipped"] == 2 and len(d["errors"]) == 2
    doc = db.f100_items.find_one({"prompt": "TEST_it20_csv good"})
    assert doc and doc["active"] is False and doc["answers"] == ["a", "b", "c", "d"]
    r = requests.post(f"{base_url}/api/admin/f100/import", headers=H(ATOK),
                      files={"file": ("f.csv", io.BytesIO(b"foo,bar\n1,2\n"), "text/csv")})
    assert r.status_code == 422
    r = requests.post(f"{base_url}/api/admin/f100/import", headers=H(ATOK),
                      files={"file": ("f.csv", io.BytesIO(b""), "text/csv")})
    assert r.status_code == 400


# --- F100 play ---
def _start(base_url):
    r = requests.post(f"{base_url}/api/f100/start", headers=H(UTOK))
    assert r.status_code == 200, r.text
    d = r.json()
    # Backdate so the server-side elapsed-time clamp allows the fake per-question times.
    db.f100_sessions.update_one({"game_id": d["game_id"]},
                                {"$set": {"started_at": datetime.now(timezone.utc) - timedelta(minutes=10)}})
    return d


def _key(item_id):
    return db.f100_items.find_one({"item_id": item_id})["answers"]


def test_f100_start_shape(base_url):
    assert requests.post(f"{base_url}/api/f100/start").status_code == 401
    g = _start(base_url)
    assert g["seconds"] == 30 and len(g["questions"]) == 10
    q = g["questions"][0]
    assert set(q) == {"item_id", "prompt", "options"} and len(q["options"]) == 8


def test_f100_scoring_and_reuse(base_url):
    g = _start(base_url)
    qs = [q for q in g["questions"] if q["item_id"] in ITEMS]
    assert len(qs) >= 4, "other active f100 items in DB"
    k = [_key(q["item_id"]) for q in qs]
    wrong = [o for o in qs[2]["options"] if o not in k[2]]
    answers = [
        {"item_id": qs[0]["item_id"], "picks": k[0], "time_ms": 5000},                       # perfect 100
        {"item_id": qs[1]["item_id"], "picks": [k[1][1], k[1][0], k[1][2], [o for o in qs[1]["options"] if o not in k[1]][0]], "time_ms": 6000},  # 3 hits wrong order 30
        {"item_id": qs[2]["item_id"], "picks": wrong, "time_ms": 7000},                      # 0
        {"item_id": qs[3]["item_id"], "picks": [k[3][0]], "time_ms": 30000},                 # partial 10
    ]
    r = requests.post(f"{base_url}/api/f100/submit", headers=H(UTOK), json={"game_id": g["game_id"], "answers": answers})
    assert r.status_code == 200, r.text
    d = r.json()
    pts = [x["points"] for x in d["results"]]
    assert pts == [100, 30, 0, 10], pts
    assert d["score"] == 140 and d["hits"] == 8 and d["perfect"] == 1 and d["time_ms"] == 48000
    assert d["slots"] == 40 and d["total_score"] == 140 and d["rank"] >= 1
    assert d["results"][0]["key"] == k[0]
    r2 = requests.post(f"{base_url}/api/f100/submit", headers=H(UTOK), json={"game_id": g["game_id"], "answers": answers})
    assert r2.status_code == 409
    # another user's game_id cannot be used by admin
    g2 = _start(base_url)
    assert requests.post(f"{base_url}/api/f100/submit", headers=H(ATOK), json={"game_id": g2["game_id"], "answers": []}).status_code == 409
    db.f100_sessions.delete_one({"game_id": g2["game_id"]})


def test_f100_permutation_4_hits_wrong_order(base_url):
    g = _start(base_url)
    q = next(q for q in g["questions"] if q["item_id"] in ITEMS)
    k = _key(q["item_id"])
    r = requests.post(f"{base_url}/api/f100/submit", headers=H(UTOK), json={"game_id": g["game_id"], "answers": [
        {"item_id": q["item_id"], "picks": [k[3], k[2], k[1], k[0]], "time_ms": 2000}]})
    assert r.status_code == 200 and r.json()["score"] == 40


def test_f100_time_validation(base_url):
    g = _start(base_url)
    r = requests.post(f"{base_url}/api/f100/submit", headers=H(UTOK), json={"game_id": g["game_id"], "answers": [
        {"item_id": g["questions"][0]["item_id"], "picks": [], "time_ms": 999999}]})
    assert r.status_code == 422
    r = requests.post(f"{base_url}/api/f100/submit", headers=H(UTOK), json={"game_id": g["game_id"], "answers": [
        {"item_id": g["questions"][0]["item_id"], "picks": ["a", "b", "c", "d", "e"], "time_ms": 10}]})
    assert r.status_code == 422
    db.f100_sessions.delete_one({"game_id": g["game_id"]})


def test_f100_leaderboard_cumulative(base_url):
    rows = requests.get(f"{base_url}/api/f100/leaderboard").json()
    me = next(x for x in rows if x["user_id"] == USER)
    assert me["attempts"] == 2 and me["score"] == 180 and me["time_ms"] == 50000
    assert me["perfect"] == 1 and me["accuracy"] == round(100 * 12 / 80, 1)


def test_xp_includes_f100(base_url):
    r = requests.get(f"{base_url}/api/me/xp", headers=H(UTOK))
    assert r.status_code == 200
    d = r.json()
    assert d.get("xp", d.get("total_xp")) == 180 or 180 in d.values(), d


# --- Gift card ---
def test_gift_card_flow(base_url):
    r = requests.post(f"{base_url}/api/admin/store/cards", headers=H(ATOK),
                      data={"title": "TEST_it20_card", "price": "999", "stock": "1"},
                      files={"image": ("c.png", io.BytesIO(PNG), "image/png")})
    assert r.status_code == 200, r.text
    cid = r.json()["card_id"]; CARDS.append(cid)
    assert requests.get(f"{base_url}/api/admin/users/search?q=it20_us", headers=H(UTOK)).status_code == 403
    s = requests.get(f"{base_url}/api/admin/users/search?q=it20_us", headers=H(ATOK)).json()
    assert any(u["user_id"] == USER for u in s) and all("_id" not in u for u in s)
    assert requests.get(f"{base_url}/api/admin/users/search?q=a", headers=H(ATOK)).json() == []
    assert requests.post(f"{base_url}/api/admin/users/{USER}/gift-card", headers=H(UTOK), json={"card_id": cid}).status_code == 403
    assert requests.post(f"{base_url}/api/admin/users/nouser/gift-card", headers=H(ATOK), json={"card_id": cid}).status_code == 404
    assert requests.post(f"{base_url}/api/admin/users/{USER}/gift-card", headers=H(ATOK), json={"card_id": "nocard"}).status_code == 404
    r = requests.post(f"{base_url}/api/admin/users/{USER}/gift-card", headers=H(ATOK), json={"card_id": cid})
    assert r.status_code == 200 and r.json()["ok"]
    r = requests.post(f"{base_url}/api/admin/users/{USER}/gift-card", headers=H(ATOK), json={"card_id": cid})
    assert r.status_code == 409 and r.json()["detail"] == "already_owned"
    cards = requests.get(f"{base_url}/api/me/cards", headers=H(UTOK)).json()
    assert any(c["card_id"] == cid and c.get("gifted") for c in cards)
    sc = db.store_cards.find_one({"card_id": cid})
    assert sc.get("stock") == 1, "gift must not consume stock"
    assert db.notifications.find_one({"user_id": USER}) is not None


# --- Tournament ---
def test_tournament_categories(base_url):
    assert requests.put(f"{base_url}/api/admin/tournament", headers=H(UTOK), json={"categories": ["liga"]}).status_code == 403
    r = requests.put(f"{base_url}/api/admin/tournament", headers=H(ATOK), json={"categories": ["bogus"]})
    assert r.status_code == 422
    r = requests.put(f"{base_url}/api/admin/tournament", headers=H(ATOK), json={"categories": []})
    assert r.status_code == 422
    r = requests.put(f"{base_url}/api/admin/tournament", headers=H(ATOK), json={"categories": ["liga", "bogus", "persib"]})
    assert r.status_code == 200 and r.json()["categories"] == ["liga", "persib"]
    st = requests.get(f"{base_url}/api/tournament/status").json()
    assert st["categories"] == ["liga", "persib"] and st["enabled"] is False
    r = requests.put(f"{base_url}/api/admin/tournament", headers=H(ATOK), json={"categories": ALL_CATS})
    assert sorted(r.json()["categories"]) == ALL_CATS


def test_tournament_reset(base_url):
    now = datetime.now(timezone.utc)
    for b in ("classic", "time_attack", "royal"):
        db.tournament_boards.insert_one({"board": b, "user_id": USER, "name": USER, "score": 50, "updated_at": now})
    db.users.update_one({"user_id": USER}, {"$set": {"royal_points": 50}})
    assert requests.post(f"{base_url}/api/admin/tournament/reset").status_code == 401
    assert requests.post(f"{base_url}/api/admin/tournament/reset", headers=H(UTOK)).status_code == 403
    r = requests.post(f"{base_url}/api/admin/tournament/reset", headers=H(ATOK))
    assert r.status_code == 200 and r.json()["cleared"] >= 3
    assert db.tournament_boards.count_documents({}) == 0
    assert db.users.find_one({"user_id": USER})["royal_points"] == 0
    arch = db.tournament_archives.find_one({"reset_by": ADMIN})
    assert arch and len([x for x in arch["rows"] if x["user_id"] == USER]) == 3
    for b in ("classic", "time_attack", "royal"):
        lb = requests.get(f"{base_url}/api/tournament/leaderboard?board={b}").json()
        assert all(x["user_id"] != USER for x in lb)
