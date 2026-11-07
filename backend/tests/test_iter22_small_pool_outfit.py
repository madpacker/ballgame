"""Iter22: small-pool Classic score submit, fresh-user outfit, auth gating, match result scorers/MOTM.
Requires `python seed_iter22_fe.py seed` first (TEST_it22_* users)."""
import os
import time

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
ATOK, UTOK = "TEST_tok_it22_admin", "TEST_tok_it22_fresh"
MID = "mt_TEST_it22"
IDS_FILE = "/tmp/it22_wardrobe_ids.txt"


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def ids():
    if not os.path.exists(IDS_FILE):
        pytest.skip("seed not run")
    out = {}
    for line in open(IDS_FILE).read().split():
        k, v = line.split(":")
        out.setdefault(k, []).append(v)
    return out


# Auth gating (Google-only login, no guest)
class TestAuth:
    def test_me_without_token_401(self):
        assert requests.get(f"{BASE_URL}/api/auth/me").status_code == 401

    def test_me_fresh_user(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(UTOK))
        assert r.status_code == 200
        assert r.json()["user_id"] == "TEST_it22_fresh"

    def test_outfit_requires_auth(self):
        assert requests.get(f"{BASE_URL}/api/me/outfit").status_code == 401


# Small-pool Classic: total = pool size, honest fast submit must not be 422
class TestSmallPoolScore:
    def _start(self, mode="classic"):
        r = requests.post(f"{BASE_URL}/api/games/start", headers=H(UTOK), json={"mode": mode})
        assert r.status_code == 200
        return r.json()["game_id"]

    def test_trivia_pool_size(self):
        r = requests.get(f"{BASE_URL}/api/quiz-items", params={"category": "trivia"})
        assert r.status_code == 200
        assert 0 < len(r.json()) < 10

    def test_one_question_game_submit_ok(self):
        gid = self._start()
        time.sleep(1.5)
        r = requests.post(f"{BASE_URL}/api/scores", headers=H(UTOK), json={
            "game_id": gid, "score": 100, "mode": "classic", "category": "trivia", "correct": 1, "total": 1})
        assert r.status_code == 200, r.text

    def test_ten_question_instant_still_rejected(self):
        gid = self._start()
        r = requests.post(f"{BASE_URL}/api/scores", headers=H(UTOK), json={
            "game_id": gid, "score": 1000, "mode": "classic", "category": "trivia", "correct": 10, "total": 10})
        assert r.status_code == 422
        assert r.json()["detail"] == "game_too_fast"


# Fresh user outfit: empty -> PUT -> GET
class TestFreshOutfit:
    def test_fresh_outfit_empty(self):
        r = requests.get(f"{BASE_URL}/api/me/outfit", headers=H(UTOK))
        assert r.status_code == 200
        assert r.json() == {}

    def test_save_and_get_outfit(self, ids):
        body = {"character_id": ids["character"][1], "top_id": ids["top"][1],
                "bottom_id": ids["bottom"][1], "shoes_id": ids["shoes"][1]}
        r = requests.put(f"{BASE_URL}/api/me/outfit", headers=H(ATOK), json=body)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/me/outfit", headers=H(ATOK)).json()
        for k, v in body.items():
            assert g[k] == v
        # reset admin outfit so the fresh-user UI test is unaffected
        requests.put(f"{BASE_URL}/api/me/outfit", headers=H(ATOK), json={})


# Admin match result: GET /matches exposes scorers/MOTM for UBAH pre-fill
@pytest.mark.skip(reason="obsolete pre-league match schema (opponent/scorer/MOTM); see test_iter26_leagues_predictions.py")
class TestMatchResult:
    def test_match_has_scorers_motm(self):
        m = next(x for x in requests.get(f"{BASE_URL}/api/matches").json() if x["match_id"] == MID)
        assert m["final_home"] == 2 and m["final_away"] == 1
        assert len(m["scorer_player_ids"]) >= 1
        assert m["motm_player_id"]
