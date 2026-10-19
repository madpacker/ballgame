"""Iteration 13: Verify Timnas Indonesia seed in /api/quiz-items?category=garuda.

Scope (per review request):
- GET /api/quiz-items?category=garuda returns >= 80 items.
- Every item: image_url is https://img.a.transfermarkt.technology/portrait/..., options len==4,
  answer_index int in 0..3, active True, options[answer_index] is non-empty string present in options.
- HEAD check 5 deterministic sample image URLs on the Transfermarkt CDN (fail only if >25% broken).
- Regression: trivia category still 200; app-settings, news, leaderboard 200.

NOTE: review spec says /api/scores/leaderboard?mode=classic but the actual mounted route is
/api/leaderboard?mode=classic (see server.py line 402). We hit the real route.
"""
import random
import pytest
import requests


# ---------- Garuda seed data integrity ----------
class TestGarudaSeed:
    @pytest.fixture(scope="class")
    def garuda_items(self, base_url):
        s = requests.Session()
        r = s.get(f"{base_url}/api/quiz-items?category=garuda", timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list), f"expected list, got {type(body)}"
        return body

    def test_min_80_items(self, garuda_items):
        assert len(garuda_items) >= 80, f"expected >=80 garuda items, got {len(garuda_items)}"

    def test_every_item_shape(self, garuda_items):
        prefix = "https://img.a.transfermarkt.technology/portrait/"
        bad = []
        for it in garuda_items:
            iid = it.get("item_id", "<no-id>")
            img = it.get("image_url")
            opts = it.get("options")
            ans = it.get("answer_index")
            active = it.get("active")
            if not (isinstance(img, str) and img.startswith(prefix)):
                bad.append((iid, "image_url", img))
                continue
            if not (isinstance(opts, list) and len(opts) == 4):
                bad.append((iid, "options_len", opts))
                continue
            if not (isinstance(ans, int) and 0 <= ans <= 3):
                bad.append((iid, "answer_index", ans))
                continue
            if active is not True:
                bad.append((iid, "active", active))
                continue
            correct = opts[ans]
            if not (isinstance(correct, str) and correct.strip() and correct in opts):
                bad.append((iid, "answer_option", correct))
        assert not bad, f"malformed garuda items: {bad[:5]} (total {len(bad)})"

    def test_category_is_garuda_only(self, garuda_items):
        for it in garuda_items:
            assert it.get("category") == "garuda", f"wrong category in {it.get('item_id')}: {it.get('category')}"


# ---------- CDN image availability (sample) ----------
class TestTransfermarktCDN:
    def test_sample_image_urls_reachable(self, base_url):
        r = requests.get(f"{base_url}/api/quiz-items?category=garuda", timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 5, "need at least 5 items to sample"
        rnd = random.Random(42)
        sample = rnd.sample(items, 5)
        results = []
        for it in sample:
            url = it["image_url"]
            try:
                # HEAD; some CDNs don't allow HEAD, so fall back to small GET on failure
                h = requests.head(url, timeout=15, allow_redirects=True,
                                  headers={"User-Agent": "Mozilla/5.0"})
                status = h.status_code
                if status in (403, 405):
                    g = requests.get(url, timeout=15, stream=True,
                                     headers={"User-Agent": "Mozilla/5.0"})
                    status = g.status_code
                    g.close()
            except Exception as e:
                status = f"ERR:{type(e).__name__}"
            results.append((it.get("player_name") or it.get("item_id"), url, status))
            print(f"[cdn] {status}  {url}")
        ok = sum(1 for _, _, s in results if s == 200)
        broken = [r for r in results if r[2] != 200]
        # Fail only if >25% of sampled URLs are broken (i.e. <75% ok -> fewer than 4/5 ok)
        assert ok >= 4, f"too many broken CDN urls: {broken}"


# ---------- Regression (unchanged by this seed) ----------
class TestRegression:
    def test_trivia_still_200(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/quiz-items?category=trivia")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_app_settings(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/app-settings")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "background_url" in body

    def test_news_list(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/news")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_leaderboard_classic(self, base_url, api_client):
        # Real route is /api/leaderboard (review spec had typo /api/scores/leaderboard).
        r = api_client.get(f"{base_url}/api/leaderboard?mode=classic")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)
