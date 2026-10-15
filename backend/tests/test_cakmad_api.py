"""Backend tests for Cak Mad Quiz API (health, auth, scores, leaderboard, CORS, indexes)."""
import os
import pytest
from pymongo import MongoClient


# ---------- Root / health ----------
class TestRoot:
    def test_api_root(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "message" in data
        assert "Cak Mad Quiz" in data["message"]


# ---------- Auth ----------
class TestAuth:
    def test_session_exchange_invalid(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/auth/session",
            json={"session_id": "definitely-not-a-valid-session"},
        )
        assert r.status_code == 401, r.text
        body = r.json()
        assert "detail" in body

    def test_auth_me_without_bearer(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_auth_me_with_invalid_bearer(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": "Bearer invalid-token-xyz"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"

    def test_auth_me_with_malformed_header(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": "NotBearer sometoken"},
        )
        assert r.status_code == 401, r.text


# ---------- Scores (auth required) ----------
class TestScores:
    def test_submit_score_without_auth(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/scores",
            json={
                "score": 100,
                "mode": "classic",
                "category": "all",
                "correct": 8,
                "total": 10,
            },
        )
        assert r.status_code == 401, r.text

    def test_submit_score_with_invalid_bearer(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/scores",
            headers={"Authorization": "Bearer invalid-xyz"},
            json={
                "score": 100,
                "mode": "classic",
                "category": "all",
                "correct": 8,
                "total": 10,
            },
        )
        assert r.status_code == 401, r.text


# ---------- Leaderboard (public) ----------
class TestLeaderboard:
    def test_leaderboard_classic(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard?mode=classic")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)

    def test_leaderboard_time_attack(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard?mode=time_attack")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)

    def test_leaderboard_default_mode(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_leaderboard_limit_param(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard?mode=classic&limit=5")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)
        assert len(r.json()) <= 5


# ---------- CORS ----------
class TestCORS:
    def test_cors_allow_origin(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/",
            headers={"Origin": "https://example.com"},
        )
        assert r.status_code == 200
        # Starlette CORS echoes the origin when allow_origins=['*'] with allow_credentials
        allow = r.headers.get("access-control-allow-origin")
        assert allow in ("*", "https://example.com"), f"Unexpected ACAO: {allow}"

    def test_cors_preflight(self, api_client, base_url):
        r = api_client.options(
            f"{base_url}/api/scores",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert r.status_code in (200, 204), r.text
        assert r.headers.get("access-control-allow-origin") is not None


# ---------- Mongo indexes ----------
class TestMongoIndexes:
    @pytest.fixture(scope="class")
    def mongo_db(self):
        url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
        name = os.environ.get("DB_NAME") or "test_database"
        # try to read backend/.env explicitly
        try:
            from dotenv import dotenv_values
            vals = dotenv_values("/app/backend/.env")
            url = vals.get("MONGO_URL", url)
            name = vals.get("DB_NAME", name)
        except Exception:
            pass
        client = MongoClient(url)
        yield client[name]
        client.close()

    def test_users_email_unique_index(self, mongo_db):
        idx = mongo_db.users.index_information()
        email_idx = [v for k, v in idx.items() if any(f[0] == "email" for f in v.get("key", []))]
        assert email_idx, f"email index missing. Have: {list(idx.keys())}"
        assert any(v.get("unique") for v in email_idx), "email index not unique"

    def test_user_sessions_token_unique_index(self, mongo_db):
        idx = mongo_db.user_sessions.index_information()
        tok_idx = [v for k, v in idx.items() if any(f[0] == "session_token" for f in v.get("key", []))]
        assert tok_idx, f"session_token index missing. Have: {list(idx.keys())}"
        assert any(v.get("unique") for v in tok_idx), "session_token index not unique"

    def test_best_scores_composite_index(self, mongo_db):
        idx = mongo_db.best_scores.index_information()
        # expect (mode, score desc) and (user_id, mode) unique
        keys_sets = [tuple(f[0] for f in v.get("key", [])) for v in idx.values()]
        assert ("mode", "score") in keys_sets or ("mode", "score", ) in keys_sets, (
            f"Expected composite (mode, score) index. Have: {keys_sets}"
        )
        user_mode = [v for v in idx.values() if tuple(f[0] for f in v.get("key", [])) == ("user_id", "mode")]
        assert user_mode, f"Expected (user_id, mode) index. Have: {keys_sets}"
        assert any(v.get("unique") for v in user_mode), "(user_id, mode) index not unique"
