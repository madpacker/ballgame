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

    # ---------- Iteration 2 index checks ----------
    def test_users_username_unique_sparse_index(self, mongo_db):
        idx = mongo_db.users.index_information()
        uname = [v for v in idx.values() if tuple(f[0] for f in v.get("key", [])) == ("username",)]
        assert uname, f"username index missing. Have: {list(idx.keys())}"
        assert any(v.get("unique") for v in uname), "username index not unique"
        assert any(v.get("sparse") for v in uname), "username index not sparse"

    def test_friendships_follower_following_unique_index(self, mongo_db):
        idx = mongo_db.friendships.index_information()
        keys_sets = {tuple(f[0] for f in v.get("key", [])): v for v in idx.values()}
        comp = keys_sets.get(("follower_id", "following_id"))
        assert comp is not None, f"(follower_id, following_id) index missing. Have: {list(keys_sets.keys())}"
        assert comp.get("unique"), "(follower_id, following_id) index not unique"

    def test_players_player_id_unique_index(self, mongo_db):
        idx = mongo_db.players.index_information()
        pid = [v for v in idx.values() if tuple(f[0] for f in v.get("key", [])) == ("player_id",)]
        assert pid, f"player_id index missing. Have: {list(idx.keys())}"
        assert any(v.get("unique") for v in pid), "player_id index not unique"

    # ---------- Iteration 3 index checks ----------
    def test_notifications_user_created_index(self, mongo_db):
        idx = mongo_db.notifications.index_information()
        keys_sets = {tuple(f for f in v.get("key", [])): v for v in idx.values()}
        comp = keys_sets.get((("user_id", 1), ("created_at", -1)))
        assert comp is not None, (
            f"(user_id ASC, created_at DESC) index missing. Have: {list(keys_sets.keys())}"
        )

    def test_notifications_user_read_index(self, mongo_db):
        idx = mongo_db.notifications.index_information()
        keys_sets = {tuple(f for f in v.get("key", [])): v for v in idx.values()}
        comp = keys_sets.get((("user_id", 1), ("read", 1)))
        assert comp is not None, (
            f"(user_id, read) index missing. Have: {list(keys_sets.keys())}"
        )

    def test_scores_mode_week_score_index(self, mongo_db):
        idx = mongo_db.scores.index_information()
        keys_sets = {tuple(f for f in v.get("key", [])): v for v in idx.values()}
        comp = keys_sets.get((("mode", 1), ("week_key", 1), ("score", -1)))
        assert comp is not None, (
            f"(mode, week_key, score DESC) index missing. Have: {list(keys_sets.keys())}"
        )

    def test_badges_user_created_index(self, mongo_db):
        idx = mongo_db.badges.index_information()
        keys_sets = {tuple(f for f in v.get("key", [])): v for v in idx.values()}
        comp = keys_sets.get((("user_id", 1), ("created_at", -1)))
        assert comp is not None, (
            f"(user_id, created_at DESC) index missing. Have: {list(keys_sets.keys())}"
        )

    def test_badges_user_week_mode_rank_unique_index(self, mongo_db):
        idx = mongo_db.badges.index_information()
        keys_sets = {tuple(f[0] for f in v.get("key", [])): v for v in idx.values()}
        comp = keys_sets.get(("user_id", "week_key", "mode", "rank"))
        assert comp is not None, (
            f"(user_id, week_key, mode, rank) composite index missing. Have: {list(keys_sets.keys())}"
        )
        assert comp.get("unique"), "(user_id, week_key, mode, rank) index not unique"


# ---------- Iteration 3: Weekly leaderboard (public) ----------
class TestWeeklyLeaderboard:
    def test_weekly_classic_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard/weekly?mode=classic")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)

    def test_weekly_time_attack_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard/weekly?mode=time_attack")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_weekly_default_mode(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard/weekly")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_weekly_limit_param(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard/weekly?mode=classic&limit=5")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 5


# ---------- Iteration 3: Admin seed-players endpoint ----------
class TestAdminSeedPlayers:
    def test_seed_players_without_auth(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/admin/seed-players")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_seed_players_with_invalid_bearer(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/admin/seed-players",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"


# ---------- Iteration 3: Notifications (auth required) ----------
class TestNotifications:
    def test_notifications_list_without_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/notifications")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_notifications_list_invalid_bearer(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/notifications",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"

    def test_notifications_unread_count_without_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/notifications/unread-count")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_notifications_unread_count_invalid_bearer(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/notifications/unread-count",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text

    def test_notifications_read_all_without_auth(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/notifications/read-all")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_notifications_read_all_invalid_bearer(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/notifications/read-all",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text


# ---------- Iteration 3: Badges (auth required) ----------
class TestBadges:
    def test_me_badges_without_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/me/badges")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_me_badges_invalid_bearer(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/me/badges",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"


# ---------- Iteration 3: Regression for iteration 1/2 endpoints ----------
class TestRegression:
    def test_api_root_still_works(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert "Cak Mad Quiz" in r.json().get("message", "")

    def test_leaderboard_classic_still_works(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard?mode=classic")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_players_list_still_works(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/players")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- Iteration 2: Players (public read + admin gated) ----------
class TestPlayers:
    def test_players_list_public_no_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/players")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)

    def test_players_list_include_all_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/players?include_all=true")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_admin_players_create_without_auth(self, api_client, base_url):
        # Multipart without auth must be 401
        files = {"photo": ("x.jpg", b"\x89PNGfake", "image/jpeg")}
        data = {
            "name": "TEST_Player",
            "position": "GK",
            "years_at_mu": "2020-2024",
            "previous_clubs": "Club A, Club B",
            "included_in_quiz": "true",
        }
        # requests Session default header is application/json; strip it for multipart
        s = api_client
        s.headers.pop("Content-Type", None)
        r = s.post(f"{base_url}/api/admin/players", data=data, files=files)
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_admin_players_create_with_invalid_bearer(self, api_client, base_url):
        files = {"photo": ("x.jpg", b"\x89PNGfake", "image/jpeg")}
        data = {"name": "TEST_Player2", "position": "DEF"}
        s = api_client
        s.headers.pop("Content-Type", None)
        r = s.post(
            f"{base_url}/api/admin/players",
            data=data,
            files=files,
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"

    def test_admin_players_patch_without_auth(self, api_client, base_url):
        r = api_client.patch(
            f"{base_url}/api/admin/players/pl_fake?included_in_quiz=false"
        )
        assert r.status_code == 401, r.text

    def test_admin_players_delete_without_auth(self, api_client, base_url):
        r = api_client.delete(f"{base_url}/api/admin/players/pl_fake")
        assert r.status_code == 401, r.text


# ---------- Iteration 2: Friends scope on leaderboard ----------
class TestLeaderboardFriendsScope:
    def test_friends_scope_without_auth_returns_empty(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard?mode=classic&scope=friends")
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_friends_scope_invalid_bearer_returns_empty(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/leaderboard?mode=classic&scope=friends",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_friends_scope_malformed_header_returns_empty(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/leaderboard?mode=time_attack&scope=friends",
            headers={"Authorization": "NotBearer stuff"},
        )
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_global_scope_still_works(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard?mode=classic&scope=global")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)


# ---------- Iteration 2: Friends endpoints (auth required) ----------
class TestFriends:
    def test_friends_list_without_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/friends")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_friends_list_invalid_bearer(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/friends",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"

    def test_friends_follow_without_auth(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/friends/follow",
            json={"code": "MU-ABCDEF"},
        )
        assert r.status_code == 401, r.text

    def test_friends_unfollow_without_auth(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/friends/unfollow",
            json={"code": "MU-ABCDEF"},
        )
        assert r.status_code == 401, r.text

    def test_friends_search_without_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/friends/search?q=anything")
        assert r.status_code == 401, r.text

    def test_friends_search_invalid_bearer(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/friends/search?q=anything",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text

    def test_friends_search_q_min_length(self, api_client, base_url):
        # even with auth missing, FastAPI validates query params first OR auth first
        # — observe actual behavior: with no auth, missing_token (401) is expected
        # because Depends is resolved before body/query validation in FastAPI.
        r = api_client.get(f"{base_url}/api/friends/search?q=a")
        # Either 401 (auth checked first) or 422 (validation first). Accept 401 per impl.
        assert r.status_code in (401, 422), r.text


# ---------- Iteration 2: Files pass-through ----------
class TestFiles:
    def test_files_nonexistent_returns_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/files/non-existent-path")
        assert r.status_code == 404, r.text
        assert r.json().get("detail") == "not_found"

    def test_files_nested_nonexistent_returns_404(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/files/cakmad-quiz/uploads/doesnotexist/x.jpg"
        )
        assert r.status_code == 404, r.text



# ---------- Iteration 4: Weekly theme (public, no auth) ----------
class TestWeeklyTheme:
    EXPECTED_KEYS = {"week_key", "id", "title", "subtitle", "filter_type", "filter_value", "accent"}

    def test_weekly_theme_public_200(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/weekly-theme")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)

    def test_weekly_theme_has_all_keys(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/weekly-theme")
        assert r.status_code == 200
        data = r.json()
        missing = self.EXPECTED_KEYS - set(data.keys())
        assert not missing, f"Missing keys: {missing}. Got: {list(data.keys())}"

    def test_weekly_theme_week_key_format(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/weekly-theme")
        assert r.status_code == 200
        wk = r.json()["week_key"]
        # 'YYYY-Wnn'
        assert isinstance(wk, str) and "-W" in wk, f"bad week_key: {wk}"
        y, w = wk.split("-W")
        assert y.isdigit() and len(y) == 4
        assert w.isdigit() and 1 <= int(w) <= 53

    def test_weekly_theme_deterministic(self, api_client, base_url):
        r1 = api_client.get(f"{base_url}/api/weekly-theme").json()
        r2 = api_client.get(f"{base_url}/api/weekly-theme").json()
        assert r1 == r2, "Weekly theme must be deterministic for the same week"

    def test_weekly_theme_values_sane(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/weekly-theme").json()
        assert isinstance(r["id"], str) and r["id"]
        assert isinstance(r["title"], str) and r["title"]
        assert isinstance(r["subtitle"], str)
        assert isinstance(r["filter_type"], str) and r["filter_type"]
        # filter_value can be list or bool depending on theme
        assert isinstance(r["filter_value"], (list, bool))
        assert isinstance(r["accent"], str) and r["accent"].startswith("#")


# ---------- Iteration 4: Streak (auth required) ----------
class TestStreak:
    def test_streak_without_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/me/streak")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_streak_with_invalid_bearer(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/me/streak",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"

    def test_streak_malformed_header(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/me/streak",
            headers={"Authorization": "NotBearer sometoken"},
        )
        assert r.status_code == 401, r.text


# ---------- Iteration 4: Skins (auth required) ----------
class TestSkins:
    def test_skins_without_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/me/skins")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_skins_with_invalid_bearer(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/me/skins",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"

    def test_skins_malformed_header(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/me/skins",
            headers={"Authorization": "NotBearer sometoken"},
        )
        assert r.status_code == 401, r.text


# ---------- Iteration 4: UserOut regression — /auth/me must still 401 (not 500) ----------
class TestAuthMeRegressionIter4:
    def test_auth_me_without_bearer_still_401(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_auth_me_invalid_bearer_still_401(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"


# ---------- Iteration 4: Regression on earlier endpoints ----------
class TestRegressionIter4:
    def test_api_root(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert "Cak Mad Quiz" in r.json().get("message", "")

    def test_leaderboard_classic(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard?mode=classic")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_leaderboard_weekly_classic(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard/weekly?mode=classic")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_players_list_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/players")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_notifications_requires_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/notifications")
        assert r.status_code == 401
        assert r.json().get("detail") == "missing_token"


# ---------- Iteration 5: Rematch Challenges ----------
class TestChallengesCreate:
    """POST /api/challenges/create — auth required."""

    def test_create_without_auth(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/challenges/create",
            json={"score": 100, "mode": "classic", "category": "all"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_create_with_invalid_bearer(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/challenges/create",
            headers={"Authorization": "Bearer invalid-xyz"},
            json={"score": 100, "mode": "classic", "category": "all"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"

    def test_create_with_malformed_header(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/challenges/create",
            headers={"Authorization": "NotBearer sometoken"},
            json={"score": 100, "mode": "classic", "category": "all"},
        )
        assert r.status_code == 401, r.text


class TestChallengesGet:
    """GET /api/challenges/{id} — public (no auth)."""

    def test_get_nonexistent_returns_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/challenges/ch_nonexistent12345")
        assert r.status_code == 404, r.text
        assert r.json().get("detail") == "challenge_not_found"

    def test_get_is_public_no_auth_required(self, api_client, base_url):
        # No Authorization header: must NOT return 401 — endpoint is public.
        # Non-existent id yields 404, which proves auth is not enforced here.
        r = api_client.get(f"{base_url}/api/challenges/anything-random")
        assert r.status_code != 401, (
            f"GET /api/challenges/{{id}} should be public but returned 401. Body: {r.text}"
        )
        assert r.status_code == 404, r.text
        assert r.json().get("detail") == "challenge_not_found"

    def test_get_with_bogus_bearer_still_404_not_401(self, api_client, base_url):
        # Even with a bad bearer, since endpoint has no Depends(get_current_user),
        # it should ignore the header and return 404 for a missing id.
        r = api_client.get(
            f"{base_url}/api/challenges/ch_doesnotexist",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 404, r.text
        assert r.json().get("detail") == "challenge_not_found"


class TestChallengesComplete:
    """POST /api/challenges/{id}/complete — auth required."""

    def test_complete_without_auth(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/challenges/ch_whatever/complete",
            json={"score": 123},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "missing_token"

    def test_complete_with_invalid_bearer(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/challenges/ch_whatever/complete",
            headers={"Authorization": "Bearer invalid-xyz"},
            json={"score": 123},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "invalid_session"

    def test_complete_with_malformed_header(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/challenges/ch_whatever/complete",
            headers={"Authorization": "NotBearer sometoken"},
            json={"score": 123},
        )
        assert r.status_code == 401, r.text

    def test_complete_nonexistent_id_without_auth_is_401_not_404(
        self, api_client, base_url
    ):
        # Auth is resolved before the DB lookup, so missing auth → 401 even
        # for a non-existent challenge id.
        r = api_client.post(
            f"{base_url}/api/challenges/ch_definitely_absent/complete",
            json={"score": 999999},
        )
        assert r.status_code == 401, r.text


# ---------- Iteration 5: Mongo indexes for challenges ----------
class TestChallengesIndexes:
    @pytest.fixture(scope="class")
    def mongo_db(self):
        url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
        name = os.environ.get("DB_NAME") or "test_database"
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

    def test_challenges_challenge_id_unique_index(self, mongo_db):
        idx = mongo_db.challenges.index_information()
        cid = [v for v in idx.values() if tuple(f[0] for f in v.get("key", [])) == ("challenge_id",)]
        assert cid, f"challenge_id index missing. Have: {list(idx.keys())}"
        assert any(v.get("unique") for v in cid), "challenge_id index not unique"

    def test_challenges_from_user_created_index(self, mongo_db):
        idx = mongo_db.challenges.index_information()
        keys_sets = {tuple(f for f in v.get("key", [])): v for v in idx.values()}
        comp = keys_sets.get((("from_user_id", 1), ("created_at", -1)))
        assert comp is not None, (
            f"(from_user_id ASC, created_at DESC) index missing. Have: {list(keys_sets.keys())}"
        )


# ---------- Iteration 5: Regression on iterations 1-4 ----------
class TestRegressionIter5:
    def test_api_root(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert "Cak Mad Quiz" in r.json().get("message", "")

    def test_weekly_theme_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/weekly-theme")
        assert r.status_code == 200
        data = r.json()
        assert "week_key" in data and "id" in data

    def test_leaderboard_weekly_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard/weekly")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_notifications_requires_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/notifications")
        assert r.status_code == 401
        assert r.json().get("detail") == "missing_token"



# ---------- Iteration 6: Top Streaks (public widget) ----------
class TestTopStreaks:
    """GET /api/top-streaks — public, no auth."""

    def test_top_streaks_public_200(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/top-streaks")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)

    def test_top_streaks_no_auth_not_401(self, api_client, base_url):
        # Must NOT require auth: no Authorization header, must not return 401.
        r = api_client.get(f"{base_url}/api/top-streaks")
        assert r.status_code != 401, f"Expected public but got 401. Body: {r.text}"
        assert r.status_code == 200

    def test_top_streaks_ignores_bogus_bearer(self, api_client, base_url):
        # Even a bogus Authorization header should be ignored (no Depends).
        r = api_client.get(
            f"{base_url}/api/top-streaks",
            headers={"Authorization": "Bearer invalid-xyz"},
        )
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_top_streaks_limit_param(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/top-streaks?limit=3")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 3

    def test_top_streaks_limit_1(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/top-streaks?limit=1")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 1

    def test_top_streaks_default_limit(self, api_client, base_url):
        # Default is 5
        r = api_client.get(f"{base_url}/api/top-streaks")
        assert r.status_code == 200, r.text
        assert len(r.json()) <= 5

    def test_top_streaks_item_shape(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/top-streaks?limit=50")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        expected_keys = {"user_id", "name", "username", "current_streak", "best_streak"}
        for item in data:
            missing = expected_keys - set(item.keys())
            assert not missing, f"Missing keys in StreakLeader: {missing}. Item: {item}"
            # Must only include users with current_streak > 0
            assert isinstance(item["current_streak"], int)
            assert item["current_streak"] > 0, (
                f"Only users with current_streak>0 should be returned; got {item}"
            )
            assert isinstance(item["best_streak"], int)
            assert isinstance(item["user_id"], str) and item["user_id"]
            assert isinstance(item["name"], str)
            assert isinstance(item["username"], str)

    def test_top_streaks_sorted_desc(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/top-streaks?limit=50")
        assert r.status_code == 200, r.text
        data = r.json()
        streaks = [item["current_streak"] for item in data]
        assert streaks == sorted(streaks, reverse=True), (
            f"Results not sorted by current_streak desc: {streaks}"
        )


# ---------- Iteration 6: Mongo index for top-streaks ----------
class TestTopStreaksIndex:
    @pytest.fixture(scope="class")
    def mongo_db(self):
        url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
        name = os.environ.get("DB_NAME") or "test_database"
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

    def test_users_current_streak_desc_index(self, mongo_db):
        idx = mongo_db.users.index_information()
        keys_sets = {tuple(f for f in v.get("key", [])): v for v in idx.values()}
        # Expect index on current_streak desc
        comp = keys_sets.get((("current_streak", -1),))
        assert comp is not None, (
            f"(current_streak DESC) index missing. Have: {list(keys_sets.keys())}"
        )


# ---------- Iteration 6: Regression ----------
class TestRegressionIter6:
    def test_api_root(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert "Cak Mad Quiz" in r.json().get("message", "")

    def test_weekly_theme_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/weekly-theme")
        assert r.status_code == 200
        data = r.json()
        assert "week_key" in data and "id" in data

    def test_challenges_get_nonexistent_public_404(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/challenges/non-existent")
        assert r.status_code == 404, r.text
        assert r.json().get("detail") == "challenge_not_found"

    def test_notifications_requires_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/notifications")
        assert r.status_code == 401
        assert r.json().get("detail") == "missing_token"

    def test_leaderboard_weekly_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/leaderboard/weekly")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
