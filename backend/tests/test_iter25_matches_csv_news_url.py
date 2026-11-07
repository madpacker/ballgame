"""Iter25: admin match fixtures CSV import + news fetch-from-URL (Google News) + news cover_url.
Requires `python seed_iter25_fe.py seed` (TEST admin/user sessions). Cleans up created matches/news."""
import os
import re
from datetime import datetime, timedelta, timezone

import pymongo
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
ADMIN = {"Authorization": "Bearer TEST_tok_it25_admin"}
USER = {"Authorization": "Bearer TEST_tok_it25_user"}
CREATED_MATCHES, CREATED_NEWS = [], []
FUT = (datetime.now(timezone.utc) + timedelta(days=200)).date()
FUT2 = FUT + timedelta(days=1)


def _import(csv_text, headers=ADMIN):
    return requests.post(f"{BASE}/api/admin/matches/import", headers=headers,
                         files={"file": ("jadwal.csv", csv_text.encode(), "text/csv")}, timeout=60)


def _track_matches():
    for m in db.matches.find({"created_by": "TEST_it25_admin"}, {"match_id": 1}):
        if m["match_id"] not in CREATED_MATCHES:
            CREATED_MATCHES.append(m["match_id"])


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    _track_matches()
    if CREATED_MATCHES:
        db.matches.delete_many({"match_id": {"$in": CREATED_MATCHES}})
    for nid in CREATED_NEWS:
        requests.delete(f"{BASE}/api/admin/news/{nid}", headers=ADMIN)
        db.news.delete_one({"news_id": nid})


def _get_match(opp):
    r = requests.get(f"{BASE}/api/matches")
    return [m for m in r.json() if m["opponent"] == opp]


# ---- Matches CSV import ----
@pytest.mark.skip(reason="obsolete pre-league match schema (opponent/scorer/MOTM); see test_iter26_leagues_predictions.py")
class TestMatchesImport:
    def test_non_admin_forbidden(self):
        r = _import(f"opponent,date,time,home\nTEST_X,{FUT},19:00,home\n", USER)
        assert r.status_code in (401, 403)
        r2 = requests.post(f"{BASE}/api/admin/matches/import",
                           files={"file": ("a.csv", b"opponent,date\nTEST_X,2030-01-01\n", "text/csv")})
        assert r2.status_code in (401, 403)

    def test_english_headers_wib_conversion(self):
        csv_text = (f"opponent,date,time,home,competition\n"
                    f"TEST_it25_Persija,{FUT},19:00,home,Piala Presiden\n"
                    f"TEST_it25_Arema,{FUT2},15:30,away,\n")
        r = _import(csv_text)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 2 and d["skipped"] == 0, d
        m = _get_match("TEST_it25_Persija")[0]
        assert m["kickoff_at"].startswith(f"{FUT}T12:00"), m["kickoff_at"]
        assert m["home"] is True and m["competition"] == "Piala Presiden" and m["status"] == "upcoming"
        a = _get_match("TEST_it25_Arema")[0]
        assert a["kickoff_at"].startswith(f"{FUT2}T08:30"), a["kickoff_at"]
        assert a["home"] is False and a["competition"] == "Liga 1"

    def test_indonesian_aliases_semicolon_ddmmyyyy(self):
        d1 = FUT.strftime("%d/%m/%Y")
        csv_text = (f"lawan;tanggal;jam;kandang;kompetisi\n"
                    f"TEST_it25_Persib;{d1};20:00;tandang;Liga 1\n"
                    f"TEST_it25_Bali;{FUT2};19.00;kandang;\n")
        r = _import(csv_text)
        assert r.status_code == 200, r.text
        assert r.json()["created"] == 2, r.json()
        p = _get_match("TEST_it25_Persib")[0]
        assert p["home"] is False and p["kickoff_at"].startswith(f"{FUT}T13:00")
        b = _get_match("TEST_it25_Bali")[0]
        assert b["home"] is True and b["kickoff_at"].startswith(f"{FUT2}T12:00")

    def test_past_invalid_duplicate_skipped(self):
        csv_text = (f"opponent,date,time,home\n"
                    f"TEST_it25_Past,2020-01-01,19:00,home\n"
                    f"TEST_it25_Bad,not-a-date,19:00,home\n"
                    f",{FUT},19:00,home\n"
                    f"TEST_it25_Persija,{FUT},19:00,home\n"  # existing -> duplicate
                    f"TEST_it25_New,{FUT},21:00,home\n"
                    f"TEST_it25_New,{FUT},21:00,home\n")  # in-file duplicate
        r = _import(csv_text)
        assert r.status_code == 200, r.text
        d = r.json()
        print(d)
        assert d["created"] == 1
        assert d["skipped"] == 5
        joined = " ".join(d["errors"])
        assert "sudah lewat" in joined and "format tanggal" in joined and "wajib" in joined
        assert "2 jadwal sudah ada" in joined
        assert len(_get_match("TEST_it25_Past")) == 0

    def test_empty_file(self):
        r = _import("")
        assert r.status_code == 400


# ---- News fetch-url ----
def _gnews_links():
    t = requests.get("https://news.google.com/rss/search?q=madura+united&hl=id&gl=ID&ceid=ID:id", timeout=20).text
    return re.findall(r"<item><title>(.*?)</title><link>(.*?)</link>", t)


class TestNewsFetchUrl:
    def test_non_admin_forbidden(self):
        r = requests.post(f"{BASE}/api/admin/news/fetch-url", headers=USER, json={"url": "https://example.com"})
        assert r.status_code in (401, 403)

    def test_non_http_422(self):
        r = requests.post(f"{BASE}/api/admin/news/fetch-url", headers=ADMIN, json={"url": "ftp://x.com/a"})
        assert r.status_code == 422

    def test_unreachable_422(self):
        # 422 (not 502) so the Indonesian detail survives the public gateway.
        r = requests.post(f"{BASE}/api/admin/news/fetch-url", headers=ADMIN,
                          json={"url": "https://this-host-does-not-exist-xyz123.invalid/a"}, timeout=60)
        assert r.status_code == 422, r.text
        assert "detail" in r.json()

    def test_private_host_blocked(self):
        r = requests.post(f"{BASE}/api/admin/news/fetch-url", headers=ADMIN,
                          json={"url": "http://127.0.0.1:8001/api/health"}, timeout=30)
        assert r.status_code == 422

    def test_google_news_article(self):
        links = _gnews_links()
        assert links, "no RSS items"
        ok = []
        for title, link in links[:8]:
            r = requests.post(f"{BASE}/api/admin/news/fetch-url", headers=ADMIN, json={"url": link}, timeout=120)
            print(r.status_code, title[:70], r.text[:160])
            if r.status_code == 200:
                ok.append(r.json())
            if len(ok) >= 2:
                break
        assert ok, "no Google News article could be fetched"
        for d in ok:
            assert d["title"].strip()
            assert len(d["body"]) > 200
            assert "news.google." not in d["source_url"]
            assert d["source_name"]
            for ln in d["body"].split("\n"):
                low = ln.strip().lower()
                assert not low.startswith(("baca juga", "advertisement", "iklan", "sponsored", "scroll to continue"))
            print("cover:", d["cover_url"], "source:", d["source_name"])
        assert any((d["cover_url"] or "").startswith("/api/files/") for d in ok)
        pytest.fetched = ok[0]


# ---- News create with cover_url ----
class TestNewsCoverUrl:
    def test_create_with_fetched_cover(self):
        d = getattr(pytest, "fetched", None)
        cover = d["cover_url"] if d and d.get("cover_url") else None
        if not cover:
            pytest.skip("no fetched cover")
        r = requests.post(f"{BASE}/api/admin/news", headers=ADMIN,
                          data={"title": "TEST_it25 " + d["title"][:80], "body": d["body"], "cover_url": cover})
        assert r.status_code == 200, r.text
        n = r.json()
        CREATED_NEWS.append(n["news_id"])
        assert n["cover_url"] == cover
        g = requests.get(f"{BASE}/api/news/{n['news_id']}").json()
        assert g["cover_url"] == cover
        img = requests.get(f"{BASE}{cover}")
        assert img.status_code == 200 and img.headers["content-type"].startswith("image/")

    def test_external_cover_ignored(self):
        r = requests.post(f"{BASE}/api/admin/news", headers=ADMIN,
                          data={"title": "TEST_it25 ext cover", "body": "body text", "cover_url": "https://evil.com/x.jpg"})
        assert r.status_code == 200, r.text
        n = r.json()
        CREATED_NEWS.append(n["news_id"])
        assert n["cover_url"] is None
