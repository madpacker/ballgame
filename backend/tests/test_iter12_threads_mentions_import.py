"""Iteration 12: threaded comments, @mentions + /users/search, CSV import.

Follows the same Mongo-seed pattern as iter 11: seeds admin + non-admin users
and user_sessions directly in Mongo so we can hit real HTTP endpoints with
valid bearer tokens.
"""
import io
import os
import uuid
import secrets
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import dotenv_values


# ---------- Shared mongo fixture ----------
@pytest.fixture(scope="module")
def mongo_db():
    vals = dotenv_values("/app/backend/.env")
    url = vals.get("MONGO_URL") or os.environ["MONGO_URL"]
    name = vals.get("DB_NAME") or os.environ["DB_NAME"]
    client = MongoClient(url)
    yield client[name]
    client.close()


def _seed_user(mongo_db, is_admin: bool, prefix: str, name: str = None, short_code: str = None) -> dict:
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:6]}@example.com"
    token = f"TEST_tok_{secrets.token_hex(16)}"
    doc = {
        "user_id": user_id,
        "email": email,
        "name": name or f"{prefix} User",
        "picture": None,
        "username": f"MU-{secrets.token_hex(3).upper()}",
        "is_admin": is_admin,
        "created_at": datetime.now(timezone.utc),
    }
    if short_code:
        doc["short_code"] = short_code
    mongo_db.users.insert_one(doc)
    mongo_db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user_id": user_id, "email": email, "token": token, "name": doc["name"]}


# ---------- user fixtures ----------
@pytest.fixture(scope="module")
def admin_bearer(mongo_db):
    u = _seed_user(mongo_db, True, "iter12_admin")
    yield u
    mongo_db.user_sessions.delete_one({"session_token": u["token"]})
    mongo_db.users.delete_one({"user_id": u["user_id"]})
    mongo_db.quiz_items.delete_many({"created_by": u["user_id"]})
    mongo_db.news.delete_many({"author_id": u["user_id"]})


@pytest.fixture(scope="module")
def user_a(mongo_db):
    u = _seed_user(mongo_db, False, "iter12_ua")
    yield u
    mongo_db.user_sessions.delete_one({"session_token": u["token"]})
    mongo_db.users.delete_one({"user_id": u["user_id"]})


@pytest.fixture(scope="module")
def user_b(mongo_db):
    u = _seed_user(mongo_db, False, "iter12_ub")
    yield u
    mongo_db.user_sessions.delete_one({"session_token": u["token"]})
    mongo_db.users.delete_one({"user_id": u["user_id"]})


@pytest.fixture(scope="module")
def user_alice(mongo_db):
    # unique name that starts with Alice for mention auto-parse
    unique = f"Alice_{secrets.token_hex(3)}"
    u = _seed_user(mongo_db, False, "iter12_alice", name=unique, short_code=f"ali{secrets.token_hex(2)}")
    yield u
    mongo_db.user_sessions.delete_one({"session_token": u["token"]})
    mongo_db.users.delete_one({"user_id": u["user_id"]})


@pytest.fixture(scope="module")
def news_item(mongo_db, admin_bearer, base_url):
    r = requests.post(
        f"{base_url}/api/admin/news",
        headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        data={"title": "TEST_News Iter12", "body": "Body for iter12 threads tests."},
    )
    assert r.status_code == 200, r.text
    news_id = r.json()["news_id"]
    yield news_id
    mongo_db.news.delete_one({"news_id": news_id})
    mongo_db.news_likes.delete_many({"news_id": news_id})
    mongo_db.news_comments.delete_many({"news_id": news_id})


@pytest.fixture(scope="module")
def news_item_b(mongo_db, admin_bearer, base_url):
    """A second article for the cross-article parent 404 test."""
    r = requests.post(
        f"{base_url}/api/admin/news",
        headers={"Authorization": f"Bearer {admin_bearer['token']}"},
        data={"title": "TEST_News Iter12 B", "body": "Second article."},
    )
    assert r.status_code == 200, r.text
    news_id = r.json()["news_id"]
    yield news_id
    mongo_db.news.delete_one({"news_id": news_id})
    mongo_db.news_comments.delete_many({"news_id": news_id})


# =============== 1. Threaded comments ===============
class TestThreadedComments:
    def test_reply_stored_and_nested_in_parent(self, base_url, news_item, user_a, user_b, mongo_db):
        # user A posts top-level
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}", "Content-Type": "application/json"},
            json={"body": "top-level parent comment"},
        )
        assert r.status_code == 200, r.text
        top_id = r.json()["comment_id"]
        assert r.json()["parent_comment_id"] is None

        # user B replies
        r2 = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_b['token']}", "Content-Type": "application/json"},
            json={"body": "a reply to top", "parent_comment_id": top_id},
        )
        assert r2.status_code == 200, r2.text
        reply_id = r2.json()["comment_id"]
        assert r2.json()["parent_comment_id"] == top_id

        # GET /comments returns the top with reply inside replies
        g = requests.get(f"{base_url}/api/news/{news_item}/comments")
        assert g.status_code == 200
        comments = g.json()
        top = next((c for c in comments if c["comment_id"] == top_id), None)
        assert top is not None, "top comment missing"
        reply_ids = [c["comment_id"] for c in top["replies"]]
        assert reply_id in reply_ids, f"reply {reply_id} not nested under top. got {reply_ids}"
        # Reply should NOT appear as top-level
        top_level_ids = [c["comment_id"] for c in comments]
        assert reply_id not in top_level_ids

        # comment_count increments for BOTH parent and reply
        n = requests.get(f"{base_url}/api/news/{news_item}").json()
        assert n["comment_count"] >= 2, f"expected >=2 comments got {n['comment_count']}"

        # stash for next tests via mongo
        self._top_id = top_id
        self._reply_id = reply_id

    def test_depth_cap_reply_to_reply_flattens(self, base_url, news_item, user_a, user_b, mongo_db):
        # Make a brand-new top & reply
        rtop = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}", "Content-Type": "application/json"},
            json={"body": "depth-top"},
        )
        assert rtop.status_code == 200
        top_id = rtop.json()["comment_id"]
        rrep = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_b['token']}", "Content-Type": "application/json"},
            json={"body": "depth-reply-1", "parent_comment_id": top_id},
        )
        assert rrep.status_code == 200
        reply_id = rrep.json()["comment_id"]
        # Reply to the reply -> should flatten to top-level ancestor
        r3 = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}", "Content-Type": "application/json"},
            json={"body": "depth-reply-2", "parent_comment_id": reply_id},
        )
        assert r3.status_code == 200, r3.text
        # parent_comment_id in response should be TOP id (flattened)
        assert r3.json()["parent_comment_id"] == top_id, (
            f"expected flatten to {top_id}, got {r3.json()['parent_comment_id']}"
        )
        third_id = r3.json()["comment_id"]
        # GET: both replies should live under top in same thread, only one nesting level
        g = requests.get(f"{base_url}/api/news/{news_item}/comments").json()
        top = next((c for c in g if c["comment_id"] == top_id), None)
        assert top is not None
        child_ids = [c["comment_id"] for c in top["replies"]]
        assert reply_id in child_ids and third_id in child_ids
        # no nested replies list on children
        for child in top["replies"]:
            assert child.get("replies", []) == [], "second-level nesting leaked"

    def test_reply_cross_article_404(self, base_url, news_item, news_item_b, user_a):
        # make a comment on news_item
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}", "Content-Type": "application/json"},
            json={"body": "parent on article A"},
        )
        assert r.status_code == 200
        parent_a = r.json()["comment_id"]
        # try to reply to it under news_item_b
        r2 = requests.post(
            f"{base_url}/api/news/{news_item_b}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}", "Content-Type": "application/json"},
            json={"body": "wrong article reply", "parent_comment_id": parent_a},
        )
        assert r2.status_code == 404, r2.text
        assert "parent_not_found" in r2.text


# =============== 2. Mentions ===============
class TestMentions:
    def test_explicit_mentions_notify_targets_not_self(self, base_url, news_item, user_a, user_b, user_alice, mongo_db):
        # user_a posts a comment mentioning user_b and user_alice explicitly, and also themselves (should be ignored)
        before_b = mongo_db.notifications.count_documents({"user_id": user_b["user_id"], "kind": "news_mention"})
        before_al = mongo_db.notifications.count_documents({"user_id": user_alice["user_id"], "kind": "news_mention"})
        before_self = mongo_db.notifications.count_documents({"user_id": user_a["user_id"], "kind": "news_mention"})
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}", "Content-Type": "application/json"},
            json={"body": "hi", "mentions": [user_b["user_id"], user_alice["user_id"], user_a["user_id"]]},
        )
        assert r.status_code == 200, r.text
        mentions_resp = r.json()["mentions"]
        assert user_b["user_id"] in mentions_resp
        assert user_alice["user_id"] in mentions_resp
        assert user_a["user_id"] not in mentions_resp, "self mention should be filtered"
        # Notification docs created
        after_b = mongo_db.notifications.count_documents({"user_id": user_b["user_id"], "kind": "news_mention"})
        after_al = mongo_db.notifications.count_documents({"user_id": user_alice["user_id"], "kind": "news_mention"})
        after_self = mongo_db.notifications.count_documents({"user_id": user_a["user_id"], "kind": "news_mention"})
        assert after_b == before_b + 1, f"user_b mention notif not created ({before_b}->{after_b})"
        assert after_al == before_al + 1, f"user_alice mention notif not created ({before_al}->{after_al})"
        assert after_self == before_self, "commenter should NOT receive self-mention"

    def test_mentions_auto_parse_from_body(self, base_url, news_item, user_b, user_alice, mongo_db):
        before = mongo_db.notifications.count_documents(
            {"user_id": user_alice["user_id"], "kind": "news_mention"}
        )
        handle = user_alice["name"]  # starts with Alice_...
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_b['token']}", "Content-Type": "application/json"},
            json={"body": f"hey @{handle} welcome"},
        )
        assert r.status_code == 200, r.text
        assert user_alice["user_id"] in r.json()["mentions"], f"auto-parse missed alice. got {r.json()['mentions']}"
        after = mongo_db.notifications.count_documents(
            {"user_id": user_alice["user_id"], "kind": "news_mention"}
        )
        assert after == before + 1


# =============== 3. User search ===============
class TestUsersSearch:
    def test_empty_q_returns_empty_list(self, base_url, user_alice):
        r = requests.get(f"{base_url}/api/users/search?q=")
        assert r.status_code == 200
        assert r.json() == []

    def test_prefix_name_match_public(self, base_url, user_alice):
        # case-insensitive prefix "al"
        r = requests.get(f"{base_url}/api/users/search?q=al")  # no auth
        assert r.status_code == 200
        results = r.json()
        assert len(results) <= 8
        found = any(u["user_id"] == user_alice["user_id"] for u in results)
        assert found, f"alice not in results: {[u['name'] for u in results]}"

    def test_short_code_prefix_match(self, base_url, user_alice):
        sc = user_alice.get("short_code") or ""
        # user_alice fixture creates a short_code starting with 'ali'
        r = requests.get(f"{base_url}/api/users/search?q=ali")
        assert r.status_code == 200
        results = r.json()
        found = any(u["user_id"] == user_alice["user_id"] for u in results)
        assert found


# =============== 4. CSV import ===============
CSV_HEADER = "prompt,option_a,option_b,option_c,option_d,answer_index,active,image_url"


class TestCsvImport:
    def test_happy_path_creates_items(self, base_url, admin_bearer, mongo_db):
        csv_text = (
            CSV_HEADER + "\n" +
            "TEST_Q1 trivia?,A1,B1,C1,D1,0,true,https://example.com/a.jpg\n" +
            "TEST_Q2 trivia?,A2,B2,C2,D2,2,true,not_a_url\n"
        )
        files = {"file": ("items.csv", csv_text.encode("utf-8"), "text/csv")}
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/import",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            data={"category": "trivia"},
            files=files,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["created"] == 2, body
        assert body["skipped"] == 0
        assert body["errors"] == []
        assert len(body["items"]) == 2
        # image_url: only accept http(s) or /api/; 'not_a_url' must become None
        urls = {it["prompt"]: it["image_url"] for it in body["items"]}
        assert urls.get("TEST_Q1 trivia?") == "https://example.com/a.jpg"
        assert urls.get("TEST_Q2 trivia?") is None

        # Verify GET /quiz-items?category=trivia contains them
        g = requests.get(f"{base_url}/api/quiz-items?category=trivia")
        assert g.status_code == 200
        prompts = [it["prompt"] for it in g.json()]
        assert "TEST_Q1 trivia?" in prompts
        assert "TEST_Q2 trivia?" in prompts
        # cleanup
        mongo_db.quiz_items.delete_many({"prompt": {"$in": ["TEST_Q1 trivia?", "TEST_Q2 trivia?"]}})

    def test_row_validation_bad_answer_index_and_empty_option(self, base_url, admin_bearer, mongo_db):
        csv_text = (
            CSV_HEADER + "\n" +
            "TEST_bad_ans,A,B,C,D,7,true,\n" +            # answer_index=7 -> skipped
            "TEST_blank_a,,B,C,D,0,true,\n" +              # option_a blank -> skipped
            "TEST_ok,A,B,C,D,1,true,\n"                    # ok
        )
        files = {"file": ("items.csv", csv_text.encode("utf-8"), "text/csv")}
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/import",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            data={"category": "trivia"},
            files=files,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["created"] == 1, b
        assert b["skipped"] == 2, b
        assert len(b["errors"]) == 2
        mongo_db.quiz_items.delete_many({"prompt": {"$in": ["TEST_bad_ans", "TEST_blank_a", "TEST_ok"]}})

    def test_missing_required_column_422(self, base_url, admin_bearer):
        # drop option_d
        csv_text = "prompt,option_a,option_b,option_c,answer_index,active\nq,A,B,C,0,true\n"
        files = {"file": ("items.csv", csv_text.encode("utf-8"), "text/csv")}
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/import",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            data={"category": "trivia"},
            files=files,
        )
        assert r.status_code == 422, r.text
        assert "missing_columns" in r.text

    def test_empty_file_400(self, base_url, admin_bearer):
        files = {"file": ("items.csv", b"", "text/csv")}
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/import",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            data={"category": "trivia"},
            files=files,
        )
        assert r.status_code == 400
        assert "empty_file" in r.text

    def test_semicolon_delimiter_and_utf8_bom(self, base_url, admin_bearer, mongo_db):
        csv_text = (
            "\ufeff" +
            CSV_HEADER.replace(",", ";") + "\n" +
            "TEST_semi1;A;B;C;D;3;true;\n"
        )
        files = {"file": ("items.csv", csv_text.encode("utf-8"), "text/csv")}
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/import",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            data={"category": "trivia"},
            files=files,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["created"] == 1, b
        assert b["items"][0]["prompt"] == "TEST_semi1"
        assert b["items"][0]["answer_index"] == 3
        mongo_db.quiz_items.delete_many({"prompt": "TEST_semi1"})

    def test_order_index_appends_after_existing(self, base_url, admin_bearer, mongo_db):
        # Determine current max order_index for trivia
        existing_cursor = list(mongo_db.quiz_items.find(
            {"category": "trivia", "deleted_at": {"$exists": False}}
        ).sort("order_index", -1).limit(1))
        current_max = existing_cursor[0]["order_index"] if existing_cursor else -1

        csv_text = (
            CSV_HEADER + "\n" +
            "TEST_order1,A,B,C,D,0,true,\n" +
            "TEST_order2,A,B,C,D,0,true,\n"
        )
        files = {"file": ("items.csv", csv_text.encode("utf-8"), "text/csv")}
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/import",
            headers={"Authorization": f"Bearer {admin_bearer['token']}"},
            data={"category": "trivia"},
            files=files,
        )
        assert r.status_code == 200
        items = r.json()["items"]
        orders = sorted([it["order_index"] for it in items])
        assert orders == [current_max + 1, current_max + 2], (
            f"expected [{current_max+1},{current_max+2}] got {orders}"
        )
        mongo_db.quiz_items.delete_many({"prompt": {"$in": ["TEST_order1", "TEST_order2"]}})

    def test_import_unauth_401_or_403(self, base_url, user_a):
        csv_text = CSV_HEADER + "\n" + "q,A,B,C,D,0,true,\n"
        files = {"file": ("items.csv", csv_text.encode("utf-8"), "text/csv")}
        # no auth
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/import",
            data={"category": "trivia"},
            files={"file": ("items.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        assert r.status_code in (401, 403), r.text
        # non-admin
        r2 = requests.post(
            f"{base_url}/api/admin/quiz-items/import",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            data={"category": "trivia"},
            files={"file": ("items.csv", csv_text.encode("utf-8"), "text/csv")},
        )
        assert r2.status_code in (401, 403), r2.text


# =============== 5. Regression ===============
class TestRegression:
    def test_app_settings_public(self, base_url):
        r = requests.get(f"{base_url}/api/app-settings")
        assert r.status_code == 200

    def test_news_list_public(self, base_url):
        r = requests.get(f"{base_url}/api/news")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_news_get_detail(self, base_url, news_item):
        r = requests.get(f"{base_url}/api/news/{news_item}")
        assert r.status_code == 200
        assert r.json()["news_id"] == news_item

    def test_like_toggle_still_works(self, base_url, news_item, user_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r1 = requests.post(f"{base_url}/api/news/{news_item}/like", headers=h)
        assert r1.status_code == 200
        assert r1.json()["liked"] in (True, False)
        # toggle back to normalise
        requests.post(f"{base_url}/api/news/{news_item}/like", headers=h)

    def test_quiz_items_public_list(self, base_url):
        r = requests.get(f"{base_url}/api/quiz-items?category=trivia")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_quiz_items_reorder_still_admin(self, base_url, admin_bearer):
        r = requests.post(
            f"{base_url}/api/admin/quiz-items/reorder",
            headers={"Authorization": f"Bearer {admin_bearer['token']}", "Content-Type": "application/json"},
            json={"category": "trivia", "item_ids": []},
        )
        assert r.status_code == 200

    def test_delete_comment_not_owner_403(self, base_url, news_item, user_a, user_b):
        r = requests.post(
            f"{base_url}/api/news/{news_item}/comments",
            headers={"Authorization": f"Bearer {user_a['token']}", "Content-Type": "application/json"},
            json={"body": "owner-only"},
        )
        assert r.status_code == 200
        cid = r.json()["comment_id"]
        # user_b tries to delete it
        r2 = requests.delete(
            f"{base_url}/api/news/comments/{cid}",
            headers={"Authorization": f"Bearer {user_b['token']}"},
        )
        assert r2.status_code == 403
        # user_a can delete it
        r3 = requests.delete(
            f"{base_url}/api/news/comments/{cid}",
            headers={"Authorization": f"Bearer {user_a['token']}"},
        )
        assert r3.status_code == 200

    def test_players_public(self, base_url):
        r = requests.get(f"{base_url}/api/players")
        assert r.status_code == 200

    def test_leaderboard_public(self, base_url):
        r = requests.get(f"{base_url}/api/leaderboard?mode=classic")
        assert r.status_code == 200
