"""Iter26: leagues (6 buttons + banners), new score-only prediction model, CSV import with
home/away/date/time/stadium + auto club logos (TheSportsDB), team-logo fallback, combined leaderboard.
Requires `python seed_iter26_fe.py seed`. Cleans up TEST matches/predictions/team_logos it creates."""
import base64
import os
from datetime import datetime, timedelta, timezone

import pymongo
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN = {"Authorization": "Bearer TEST_tok_it26_admin"}
USER = {"Authorization": "Bearer TEST_tok_it26_user"}
FUT = (datetime.now(timezone.utc) + timedelta(days=200)).date()
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
KEYS = ["super_league", "liga2", "laliga", "premier_league", "serie_a", "others"]


def _import(csv_text, league=None, headers=ADMIN):
    data = {"league": league} if league else {}
    return requests.post(f"{BASE}/api/admin/matches/import", headers=headers, data=data,
                         files={"file": ("jadwal.csv", csv_text.encode(), "text/csv")}, timeout=90)


def _mine(league=None):
    r = requests.get(f"{BASE}/api/matches", params={"league": league} if league else None)
    assert r.status_code == 200
    return [m for m in r.json() if m["home_team"].startswith("TEST_") or m["away_team"].startswith("TEST_")
            or m["match_id"] in _created()]


def _created():
    return {m["match_id"] for m in db.matches.find({"created_by": "TEST_it26_admin"}, {"match_id": 1})}


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    mids = list(_created())
    db.predictions.delete_many({"match_id": {"$in": mids}})
    db.matches.delete_many({"match_id": {"$in": mids}})
    db.team_logos.delete_many({"key": {"$regex": "^test_it26"}})
    for k in KEYS:
        requests.delete(f"{BASE}/api/admin/leagues/{k}/banner", headers=ADMIN)


# ---- Leagues ----
class TestLeagues:
    def test_list_six(self):
        r = requests.get(f"{BASE}/api/leagues")
        assert r.status_code == 200
        d = r.json()
        assert [x["key"] for x in d] == KEYS
        for x in d:
            assert "banner_url" in x and isinstance(x["upcoming"], int) and x["name"]

    def test_banner_upload_delete(self):
        r = requests.post(f"{BASE}/api/admin/leagues/laliga/banner", headers=ADMIN,
                          files={"image": ("b.png", PNG, "image/png")})
        assert r.status_code == 200, r.text
        url = r.json()["banner_url"]
        assert url.startswith("/api/files/")
        lg = {x["key"]: x for x in requests.get(f"{BASE}/api/leagues").json()}
        assert lg["laliga"]["banner_url"] == url
        assert requests.get(f"{BASE}{url}").status_code == 200
        r = requests.delete(f"{BASE}/api/admin/leagues/laliga/banner", headers=ADMIN)
        assert r.status_code == 200
        lg = {x["key"]: x for x in requests.get(f"{BASE}/api/leagues").json()}
        assert lg["laliga"]["banner_url"] is None

    def test_banner_unknown_and_auth(self):
        r = requests.post(f"{BASE}/api/admin/leagues/bundesliga/banner", headers=ADMIN,
                          files={"image": ("b.png", PNG, "image/png")})
        assert r.status_code == 404
        assert requests.delete(f"{BASE}/api/admin/leagues/bundesliga/banner", headers=ADMIN).status_code == 404
        r = requests.post(f"{BASE}/api/admin/leagues/laliga/banner", headers=USER,
                          files={"image": ("b.png", PNG, "image/png")})
        assert r.status_code in (401, 403)


# ---- CSV import ----
class TestImport:
    def test_indonesian_headers_wib_and_logos(self):
        csv_text = ("tuan_rumah,tim_tamu,tanggal,jam,stadion\n"
                    f"Madura United,Persija Jakarta,{FUT},19:00,TEST_Stadion Gelora Bangkalan\n"
                    f"TEST_it26 Alpha FC,Madura United,{FUT},15:30,TEST_Stadion X\n")
        r = _import(csv_text, "super_league")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 2, d
        assert "TEST_it26 Alpha FC" in d["missing_logos"]
        ms = [m for m in requests.get(f"{BASE}/api/matches", params={"league": "super_league"}).json()
              if m["match_id"] in _created()]
        mu = [m for m in ms if m["home_team"] == "Madura United" and m["away_team"] == "Persija Jakarta"][0]
        assert mu["kickoff_at"] in (f"{FUT}T12:00:00+00:00", f"{FUT}T12:00:00Z")
        assert mu["stadium"] == "TEST_Stadion Gelora Bangkalan"
        assert mu["home_logo"] and mu["away_logo"] and mu["league"] == "super_league"
        assert mu["status"] == "upcoming"

    def test_english_headers_and_liga_column(self):
        csv_text = ("home_team,away_team,date,time,stadium,liga\n"
                    f"Arsenal,Chelsea,{FUT},21:00,TEST_Emirates,Premier League\n"
                    f"TEST_it26 Beta,TEST_it26 Gamma,{FUT},20:00,TEST_S,serie a\n")
        r = _import(csv_text)
        assert r.status_code == 200, r.text
        assert r.json()["created"] == 2, r.json()
        pl = [m for m in requests.get(f"{BASE}/api/matches", params={"league": "premier_league"}).json()
              if m["match_id"] in _created()]
        assert len(pl) == 1 and pl[0]["home_logo"] and pl[0]["away_logo"]
        assert pl[0]["kickoff_at"] in (f"{FUT}T14:00:00+00:00", f"{FUT}T14:00:00Z")
        sa = [m for m in requests.get(f"{BASE}/api/matches", params={"league": "serie_a"}).json()
              if m["match_id"] in _created()]
        assert len(sa) == 1

    def test_pertandingan_column_ddmmyyyy(self):
        d2 = FUT + timedelta(days=2)
        csv_text = f"pertandingan,tanggal,jam,stadion\nArsenal vs Chelsea,{d2.strftime('%d/%m/%Y')},19:00,TEST_P\n"
        r = _import(csv_text, "laliga")
        assert r.status_code == 200 and r.json()["created"] == 1, r.text
        m = [m for m in requests.get(f"{BASE}/api/matches", params={"league": "laliga"}).json()
             if m["match_id"] in _created()][0]
        assert m["home_team"] == "Arsenal" and m["away_team"] == "Chelsea"
        assert m["kickoff_at"] in (f"{d2}T12:00:00+00:00", f"{d2}T12:00:00Z")

    def test_skip_past_dup_invalid_noleague(self):
        csv_text = ("tuan_rumah,tim_tamu,tanggal,jam,stadion\n"
                    f"Madura United,Persija Jakarta,{FUT},19:00,TEST_dup\n"
                    "TEST_it26 Past,TEST_it26 Past2,2020-01-01,19:00,TEST\n"
                    f"TEST_it26 Bad,TEST_it26 Bad2,notadate,19:00,TEST\n"
                    f",TEST_it26 NoHome,{FUT},19:00,TEST\n")
        r = _import(csv_text, "super_league")
        assert r.status_code == 200
        d = r.json()
        assert d["created"] == 0 and d["skipped"] == 4, d
        # No league given and no liga column -> skipped with error
        r = _import(f"tuan_rumah,tim_tamu,tanggal\nTEST_it26 N1,TEST_it26 N2,{FUT}\n")
        assert r.json()["created"] == 0 and r.json()["errors"]

    def test_import_non_admin(self):
        assert _import(f"tuan_rumah,tim_tamu,tanggal\nA,B,{FUT}\n", "liga2", USER).status_code in (401, 403)


# ---- Manual create + team logo fallback ----
class TestCreateAndLogos:
    def test_create_json_and_invalid_league(self):
        ko = (datetime.now(timezone.utc) + timedelta(days=210)).replace(microsecond=0)
        r = requests.post(f"{BASE}/api/admin/matches", headers=ADMIN, json={
            "home_team": "TEST_it26 Delta", "away_team": "TEST_it26 Echo", "kickoff_at": ko.isoformat(),
            "stadium": "TEST_Std", "league": "liga2"})
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["league"] == "liga2" and m["stadium"] == "TEST_Std" and m["home_logo"] is None
        assert m["kickoff_at"].endswith(("+00:00", "Z"))
        r = requests.post(f"{BASE}/api/admin/matches", headers=ADMIN, json={
            "home_team": "A", "away_team": "B", "kickoff_at": ko.isoformat(), "league": "bundesliga"})
        assert r.status_code == 422

    def test_team_logo_upload_updates_fixtures(self):
        r = requests.post(f"{BASE}/api/admin/team-logos", headers=ADMIN, data={"name": "test_it26 delta"},
                          files={"image": ("l.png", PNG, "image/png")})
        assert r.status_code == 200, r.text
        url = r.json()["url"]
        m = [m for m in requests.get(f"{BASE}/api/matches", params={"league": "liga2"}).json()
             if m["home_team"] == "TEST_it26 Delta"][0]
        assert m["home_logo"] == url and m["away_logo"] is None
        # New fixtures with the same team pick up the cached admin logo
        ko = (datetime.now(timezone.utc) + timedelta(days=211)).isoformat()
        r = requests.post(f"{BASE}/api/admin/matches", headers=ADMIN, json={
            "home_team": "TEST_it26 Echo", "away_team": "TEST_IT26 DELTA", "kickoff_at": ko, "league": "others"})
        assert r.json()["away_logo"] == url

    def test_legacy_not_returned(self):
        r = requests.get(f"{BASE}/api/matches")
        assert r.status_code == 200
        assert all(m.get("league") for m in r.json())
        lst = [m for m in r.json() if m["status"] == "upcoming"]
        kos = [m["kickoff_at"] for m in lst]
        assert kos == sorted(kos)


# ---- Predictions & scoring ----
class TestPredictions:
    def test_predict_score_and_leaderboard(self):
        m = [m for m in requests.get(f"{BASE}/api/matches", params={"league": "liga2"}).json()
             if m["home_team"] == "TEST_it26 Delta"][0]
        mid = m["match_id"]
        assert requests.post(f"{BASE}/api/matches/{mid}/predict", json={"pred_home": 1, "pred_away": 0}).status_code == 401
        r = requests.post(f"{BASE}/api/matches/{mid}/predict", headers=USER, json={"pred_home": 100, "pred_away": 0})
        assert r.status_code == 422
        r = requests.post(f"{BASE}/api/matches/{mid}/predict", headers=USER,
                          json={"pred_home": 2, "pred_away": 1, "scorer": "x", "motm": "y"})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["pred_home"] == 2 and p["pred_away"] == 1 and "scorer" not in p and "motm" not in p
        r = requests.post(f"{BASE}/api/matches/{mid}/predict", headers=ADMIN, json={"pred_home": 0, "pred_away": 0})
        assert r.status_code == 200
        mine = requests.get(f"{BASE}/api/me/predictions", headers=USER).json()
        assert isinstance(mine, dict) and mine[mid]["pred_home"] == 2
        # exact = 300 for USER, admin predicted draw -> 0
        r = requests.post(f"{BASE}/api/admin/matches/{mid}/result", headers=ADMIN, json={"final_home": 2, "final_away": 1})
        assert r.status_code == 200 and r.json()["status"] == "finished"
        mine = requests.get(f"{BASE}/api/me/predictions", headers=USER).json()
        assert mine[mid]["points"] == 300
        adm = requests.get(f"{BASE}/api/me/predictions", headers=ADMIN).json()
        assert adm[mid]["points"] == 0
        # re-score: winner correct = 100
        requests.post(f"{BASE}/api/admin/matches/{mid}/result", headers=ADMIN, json={"final_home": 3, "final_away": 0})
        assert requests.get(f"{BASE}/api/me/predictions", headers=USER).json()[mid]["points"] == 100
        # closed after result
        r = requests.post(f"{BASE}/api/matches/{mid}/predict", headers=USER, json={"pred_home": 1, "pred_away": 1})
        assert r.status_code == 400
        lb = requests.get(f"{BASE}/api/predictions/leaderboard").json()
        me = [x for x in lb if x["user_id"] == "TEST_it26_user"]
        assert me and me[0]["total_points"] >= 100

    def test_draw_scores_100_and_combined(self):
        m = [m for m in requests.get(f"{BASE}/api/matches", params={"league": "others"}).json()
             if m["home_team"] == "TEST_it26 Echo"][0]
        mid = m["match_id"]
        requests.post(f"{BASE}/api/matches/{mid}/predict", headers=USER, json={"pred_home": 1, "pred_away": 1})
        requests.post(f"{BASE}/api/admin/matches/{mid}/result", headers=ADMIN, json={"final_home": 2, "final_away": 2})
        assert requests.get(f"{BASE}/api/me/predictions", headers=USER).json()[mid]["points"] == 100
        lb = requests.get(f"{BASE}/api/predictions/leaderboard").json()
        me = [x for x in lb if x["user_id"] == "TEST_it26_user"][0]
        assert me["total_points"] == 200 and me["predictions_count"] == 2

    def test_result_invalid(self):
        assert requests.post(f"{BASE}/api/admin/matches/mt_nope/result", headers=ADMIN,
                             json={"final_home": 1, "final_away": 0}).status_code == 404
        mid = list(_created())[0]
        assert requests.post(f"{BASE}/api/admin/matches/{mid}/result", headers=USER,
                             json={"final_home": 1, "final_away": 0}).status_code in (401, 403)

    def test_live_match_and_leagues_count(self):
        r = requests.get(f"{BASE}/api/live-match")
        assert r.status_code == 200 and "live" in r.json()
        lg = {x["key"]: x for x in requests.get(f"{BASE}/api/leagues").json()}
        assert lg["super_league"]["upcoming"] >= 2 and lg["premier_league"]["upcoming"] >= 1


class TestPredictCutoff:
    """Predictions close 30 minutes before kickoff."""

    def _mk(self, minutes):
        from datetime import datetime, timedelta, timezone
        ko = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
        r = requests.post(f"{BASE}/api/admin/matches", headers=ADMIN, json={
            "home_team": f"TEST_cut {minutes}", "away_team": "TEST_cut Away", "kickoff_at": ko, "league": "others"})
        assert r.status_code == 200, r.text
        return r.json()

    def test_cutoff(self):
        far, near = self._mk(120), self._mk(20)
        try:
            assert far["predict_open"] is True and far["predict_close_at"]
            assert near["predict_open"] is False and near["status"] == "upcoming"
            assert requests.post(f"{BASE}/api/matches/{far['match_id']}/predict", headers=USER,
                                 json={"pred_home": 1, "pred_away": 0}).status_code == 200
            r = requests.post(f"{BASE}/api/matches/{near['match_id']}/predict", headers=USER, json={"pred_home": 1, "pred_away": 0})
            assert r.status_code == 400 and r.json()["detail"] == "predictions_closed"
        finally:
            for m in (far, near):
                requests.delete(f"{BASE}/api/admin/matches/{m['match_id']}", headers=ADMIN)
