"""Iter17: match result for finished matches (re-score), new quiz categories, category logos, players->trivia migration."""
import io
import os
import struct
import zlib
from datetime import datetime, timezone, timedelta

import pymongo
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
NEW_CATS = ["liga", "bali", "persebaya", "persib", "persija"]
ADMIN_UID, ADMIN_TOK = "TEST_it17_admin", "TEST_tok_it17_admin"
P1_UID, P1_TOK = "TEST_it17_p1", "TEST_tok_it17_p1"
P2_UID, P2_TOK = "TEST_it17_p2", "TEST_tok_it17_p2"


def _png() -> bytes:
    raw = b"\x00\xff\x00\x00"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


@pytest.fixture(scope="module")
def mdb():
    db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    now = datetime.now(timezone.utc)
    for uid, tok, adm in [(ADMIN_UID, ADMIN_TOK, True), (P1_UID, P1_TOK, False), (P2_UID, P2_TOK, False)]:
        db.users.update_one({"user_id": uid}, {"$set": {"user_id": uid, "email": f"{uid}@test.local", "name": uid,
                            "username": uid, "is_admin": adm, "created_at": now}}, upsert=True)
        db.user_sessions.update_one({"session_token": tok}, {"$set": {"session_token": tok, "user_id": uid,
                                    "expires_at": now + timedelta(days=1), "created_at": now}}, upsert=True)
    yield db
    ids = [ADMIN_UID, P1_UID, P2_UID]
    for c in ("users", "user_sessions", "predictions", "notifications"):
        db[c].delete_many({"user_id": {"$in": ids}})


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Match result on auto-finished match ----------
class TestMatchResult:
    created = []

    @pytest.fixture(scope="class")
    def finished_match(self, mdb, base_url):
        # create match as upcoming, predict, then backdate kickoff to >110 min ago
        r = requests.post(f"{base_url}/api/admin/matches", headers=H(ADMIN_TOK), json={
            "opponent": "TEST_it17_FC", "kickoff_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "home": True, "competition": "TEST"})
        assert r.status_code == 200, r.text
        mid = r.json()["match_id"]
        TestMatchResult.created.append(mid)
        assert requests.post(f"{base_url}/api/matches/{mid}/predict", headers=H(P1_TOK),
                             json={"pred_home": 2, "pred_away": 1}).status_code == 200
        assert requests.post(f"{base_url}/api/matches/{mid}/predict", headers=H(P2_TOK),
                             json={"pred_home": 0, "pred_away": 0}).status_code == 200
        mdb.matches.update_one({"match_id": mid}, {"$set": {"kickoff_at": datetime.now(timezone.utc) - timedelta(minutes=200)}})
        yield mid
        for m in TestMatchResult.created:
            mdb.matches.delete_one({"match_id": m})
            mdb.predictions.delete_many({"match_id": m})

    def test_status_finished_without_score(self, base_url, finished_match):
        ms = {m["match_id"]: m for m in requests.get(f"{base_url}/api/matches").json()}
        m = ms[finished_match]
        assert m["status"] == "finished" and m["final_home"] is None

    def test_set_result_on_finished_scores_predictions(self, base_url, finished_match, mdb):
        r = requests.post(f"{base_url}/api/admin/matches/{finished_match}/result", headers=H(ADMIN_TOK),
                          json={"final_home": 2, "final_away": 1})
        assert r.status_code == 200, r.text
        assert r.json()["final_home"] == 2 and r.json()["status"] == "finished"
        pts = {p["user_id"]: p["points"] for p in mdb.predictions.find({"match_id": finished_match})}
        assert pts == {P1_UID: 300, P2_UID: 0}
        assert mdb.notifications.count_documents({"user_id": {"$in": [P1_UID, P2_UID]}}) == 2

    def test_correct_result_rescores_no_dup_notifications(self, base_url, finished_match, mdb):
        r = requests.post(f"{base_url}/api/admin/matches/{finished_match}/result", headers=H(ADMIN_TOK),
                          json={"final_home": 0, "final_away": 0})
        assert r.status_code == 200
        pts = {p["user_id"]: p["points"] for p in mdb.predictions.find({"match_id": finished_match})}
        assert pts == {P1_UID: 0, P2_UID: 300}
        assert mdb.notifications.count_documents({"user_id": {"$in": [P1_UID, P2_UID]}}) == 2
        g = [m for m in requests.get(f"{base_url}/api/matches").json() if m["match_id"] == finished_match][0]
        assert g["final_home"] == 0 and g["final_away"] == 0

    @pytest.mark.parametrize("body", [{"final_home": -100, "final_away": 1}, {"final_home": 1, "final_away": 100}])
    def test_invalid_scores_422(self, base_url, finished_match, body):
        r = requests.post(f"{base_url}/api/admin/matches/{finished_match}/result", headers=H(ADMIN_TOK), json=body)
        assert r.status_code == 422

    def test_result_nonadmin_403_and_404(self, base_url, finished_match):
        assert requests.post(f"{base_url}/api/admin/matches/{finished_match}/result", headers=H(P1_TOK),
                             json={"final_home": 1, "final_away": 1}).status_code == 403
        assert requests.post(f"{base_url}/api/admin/matches/mt_nope/result", headers=H(ADMIN_TOK),
                             json={"final_home": 1, "final_away": 1}).status_code == 404


# ---------- Quiz items new categories ----------
class TestNewCategories:
    ids = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, mdb):
        yield
        mdb.quiz_items.delete_many({"item_id": {"$in": TestNewCategories.ids}})

    @pytest.mark.parametrize("cat", NEW_CATS)
    def test_create_and_public_list(self, base_url, mdb, cat):
        r = requests.post(f"{base_url}/api/admin/quiz-items", headers=H(ADMIN_TOK), data={
            "category": cat, "prompt": f"TEST_it17 {cat}?", "option_a": "A", "option_b": "B",
            "option_c": "C", "option_d": "D", "answer_index": "2"})
        assert r.status_code == 200, r.text
        it = r.json()
        TestNewCategories.ids.append(it["item_id"])
        assert it["category"] == cat and it["answer_index"] == 2
        pub = requests.get(f"{base_url}/api/quiz-items", params={"category": cat}).json()
        assert it["item_id"] in [x["item_id"] for x in pub]
        adm = requests.get(f"{base_url}/api/admin/quiz-items", params={"category": cat}, headers=H(ADMIN_TOK)).json()
        assert it["item_id"] in [x["item_id"] for x in adm]

    def test_update_and_delete(self, base_url):
        iid = TestNewCategories.ids[0]
        r = requests.put(f"{base_url}/api/admin/quiz-items/{iid}", headers=H(ADMIN_TOK), json={"prompt": "TEST_it17 edited"})
        assert r.status_code == 200 and r.json()["prompt"] == "TEST_it17 edited"
        assert requests.delete(f"{base_url}/api/admin/quiz-items/{iid}", headers=H(ADMIN_TOK)).status_code == 200
        pub = requests.get(f"{base_url}/api/quiz-items", params={"category": "liga"}).json()
        assert iid not in [x["item_id"] for x in pub]

    def test_csv_import_persija(self, base_url):
        csv_text = "prompt,option_a,option_b,option_c,option_d,answer_index\nTEST_it17 csv1?,a,b,c,d,0\nTEST_it17 csv2?,a,b,c,d,3\n"
        r = requests.post(f"{base_url}/api/admin/quiz-items/import", headers=H(ADMIN_TOK),
                          data={"category": "persija"}, files={"file": ("q.csv", csv_text.encode(), "text/csv")})
        assert r.status_code == 200, r.text
        pub = requests.get(f"{base_url}/api/quiz-items", params={"category": "persija"}).json()
        mine = [x for x in pub if x["prompt"].startswith("TEST_it17 csv")]
        TestNewCategories.ids.extend(x["item_id"] for x in mine)
        assert len(mine) == 2 and {x["answer_index"] for x in mine} == {0, 3}

    @pytest.mark.parametrize("cat", ["guess", "history", "xyz"])
    def test_invalid_category_422(self, base_url, cat):
        assert requests.get(f"{base_url}/api/quiz-items", params={"category": cat}).status_code == 422
        r = requests.post(f"{base_url}/api/admin/quiz-items", headers=H(ADMIN_TOK), data={
            "category": cat, "prompt": "TEST_x", "option_a": "A", "option_b": "B", "option_c": "C",
            "option_d": "D", "answer_index": "0"})
        assert r.status_code == 422

    def test_all_returns_union(self, base_url):
        allq = requests.get(f"{base_url}/api/quiz-items", params={"category": "all"}).json()
        total = sum(len(requests.get(f"{base_url}/api/quiz-items", params={"category": c}).json())
                    for c in ["trivia", "garuda"] + NEW_CATS)
        assert len(allq) == total
        cats = {x["category"] for x in allq}
        assert {"trivia", "garuda"}.issubset(cats)


# ---------- Category logos ----------
class TestCategoryLogos:
    @pytest.fixture(scope="class", autouse=True)
    def _restore(self, mdb):
        before = (mdb.app_settings.find_one({"_key": "public"}) or {}).get("category_logos")
        yield
        if before is None:
            mdb.app_settings.update_one({"_key": "public"}, {"$unset": {"category_logos": ""}})
        else:
            mdb.app_settings.update_one({"_key": "public"}, {"$set": {"category_logos": before}})

    def test_upload_requires_admin(self, base_url):
        f = {"image": ("l.png", _png(), "image/png")}
        assert requests.post(f"{base_url}/api/admin/category-logo/persib", files=f).status_code == 401
        assert requests.post(f"{base_url}/api/admin/category-logo/persib", headers=H(P1_TOK),
                             files={"image": ("l.png", _png(), "image/png")}).status_code == 403
        assert requests.delete(f"{base_url}/api/admin/category-logo/persib", headers=H(P1_TOK)).status_code == 403

    def test_upload_invalid_category_422(self, base_url):
        r = requests.post(f"{base_url}/api/admin/category-logo/guess", headers=H(ADMIN_TOK),
                          files={"image": ("l.png", _png(), "image/png")})
        assert r.status_code == 422

    def test_upload_get_delete(self, base_url):
        r = requests.post(f"{base_url}/api/admin/category-logo/persib", headers=H(ADMIN_TOK),
                          files={"image": ("l.png", _png(), "image/png")})
        assert r.status_code == 200, r.text
        url = r.json()["category_logos"]["persib"]
        assert url.startswith("/api/files/")
        s = requests.get(f"{base_url}/api/app-settings").json()
        assert s["category_logos"]["persib"] == url
        f = requests.get(f"{base_url}{url}")
        assert f.status_code == 200 and f.content[:4] == b"\x89PNG"
        d = requests.delete(f"{base_url}/api/admin/category-logo/persib", headers=H(ADMIN_TOK))
        assert d.status_code == 200 and "persib" not in d.json()["category_logos"]
        assert "persib" not in requests.get(f"{base_url}/api/app-settings").json()["category_logos"]


# ---------- Migration players -> trivia ----------
class TestMigration:
    def test_flag_and_items(self, mdb):
        assert (mdb.app_settings.find_one({"_key": "migrations"}) or {}).get("players_to_trivia_v1") is True
        items = list(mdb.quiz_items.find({"source_player_id": {"$exists": True}}, {"_id": 0}))
        srcs = [i["source_player_id"] for i in items]
        assert len(srcs) == len(set(srcs)), "duplicate migrated items"
        for i in items:
            p = mdb.players.find_one({"player_id": i["source_player_id"]})
            assert i["category"] == "trivia" and len(i["options"]) == 4 and len(set(i["options"])) == 4
            assert i["options"][i["answer_index"]] == p["name"]
            assert i["prompt"] == "Siapa pemain Madura United ini?" and i["image_url"]

    def test_migrated_visible_in_public_trivia(self, base_url, mdb):
        ids = {i["item_id"] for i in mdb.quiz_items.find({"source_player_id": {"$exists": True}, "active": True,
                                                          "deleted_at": {"$exists": False}})}
        pub = {x["item_id"] for x in requests.get(f"{base_url}/api/quiz-items", params={"category": "trivia"}).json()}
        assert ids.issubset(pub)
