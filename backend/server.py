from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends, UploadFile, File, Form, Query, Request
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import random
import secrets
import string
import httpx
import requests
import re
import asyncio
import csv
import io
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta

from seed_players import SEED_PLAYERS
from themes import THEMES, pick_theme_for_week


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------- Object Storage ----------
APP_NAME = "cakmad-quiz"
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
storage_key: Optional[str] = None


def init_storage() -> str:
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


app = FastAPI()


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api_router = APIRouter(prefix="/api")


# ---------- Models ----------
class SessionExchangeIn(BaseModel):
    session_id: str


class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    username: str
    is_admin: bool = False
    current_streak: int = 0
    best_streak: int = 0
    champion_until: Optional[datetime] = None


class SessionExchangeOut(BaseModel):
    session_token: str
    user: UserOut


GameMode = Literal["classic", "time_attack", "t_classic", "t_time_attack"]


class ScoreSubmit(BaseModel):
    game_id: str = Field(min_length=4, max_length=64)
    score: int = Field(ge=0, le=50000)
    mode: GameMode
    category: str = Field(max_length=40)
    correct: int = Field(ge=0, le=500)
    total: int = Field(ge=0, le=500)


class GameStartIn(BaseModel):
    mode: GameMode


# Max questions / points per correct answer for normal modes (anti-cheat caps).
CLASSIC_MAX_Q = 10
NORMAL_POINT = 100


class LeaderboardEntry(BaseModel):
    user_id: str
    name: str
    picture: Optional[str] = None
    score: int
    mode: str
    category: str
    correct: int
    total: int
    games: int = 1
    created_at: datetime


class PlayerIn(BaseModel):
    name: str
    position: Literal["GK", "DEF", "MID", "FWD"]
    years_at_mu: Optional[str] = None  # e.g. "2017-2020"
    previous_clubs: List[str] = Field(default_factory=list)
    included_in_quiz: bool = True


class PlayerOut(PlayerIn):
    player_id: str
    photo_url: Optional[str] = None
    created_at: datetime
    created_by: Optional[str] = None


class FriendOut(BaseModel):
    user_id: str
    username: str
    name: str
    picture: Optional[str] = None


class FollowIn(BaseModel):
    code: Optional[str] = None  # username code
    email: Optional[str] = None


# ---------- Helpers ----------
def new_username() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "MU-" + "".join(secrets.choice(alphabet) for _ in range(6))


async def _ensure_user_shape(user: dict) -> dict:
    """Backfill username/is_admin for pre-existing docs."""
    updates = {}
    if not user.get("username"):
        updates["username"] = new_username()
    if "is_admin" not in user:
        # First user ever becomes admin.
        existing_admins = await db.users.count_documents({"is_admin": True})
        updates["is_admin"] = existing_admins == 0
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
        user.update(updates)
    return user


async def get_current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing_token")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="invalid_session")
    expires = session.get("expires_at")
    if isinstance(expires, datetime):
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="session_expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="user_not_found")
    user = await _ensure_user_shape(user)
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="admin_only")
    return user


def to_user_out(u: dict) -> UserOut:
    champ = u.get("champion_until")
    if isinstance(champ, datetime) and champ.tzinfo is None:
        champ = champ.replace(tzinfo=timezone.utc)
    if champ and champ < datetime.now(timezone.utc):
        champ = None
    return UserOut(
        user_id=u["user_id"],
        email=u["email"],
        name=u["name"],
        picture=u.get("picture"),
        username=u["username"],
        is_admin=bool(u.get("is_admin", False)),
        current_streak=int(u.get("current_streak", 0)),
        best_streak=int(u.get("best_streak", 0)),
        champion_until=champ,
    )


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "Cak Mad Quiz API"}


@api_router.post("/auth/session", response_model=SessionExchangeOut)
async def auth_session(body: SessionExchangeIn):
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="session_invalid")
        data = resp.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("session exchange failed: %s", e)
        raise HTTPException(status_code=401, detail="session_exchange_failed")

    email = data.get("email")
    name = data.get("name") or email
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="session_payload_invalid")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        # Keep a name / photo the user set in Pengaturan Profil instead of Google's.
        upd = {}
        if not existing.get("custom_name"):
            upd["name"] = name
        if not existing.get("custom_picture"):
            upd["picture"] = picture
        if upd:
            await db.users.update_one({"user_id": user_id}, {"$set": upd})
        user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        is_admin = (await db.users.count_documents({"is_admin": True})) == 0
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "username": new_username(),
            "is_admin": is_admin,
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(user_doc)
    user_doc = await _ensure_user_shape(user_doc)

    await db.user_sessions.insert_one(
        {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        }
    )

    return SessionExchangeOut(session_token=session_token, user=to_user_out(user_doc))


@api_router.get("/auth/me", response_model=UserOut)
async def auth_me(user: dict = Depends(get_current_user)):
    return to_user_out(user)


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Scores & Leaderboard ----------
@api_router.post("/games/start")
async def games_start(body: GameStartIn, user: dict = Depends(get_current_user)):
    game_id = f"gm_{uuid.uuid4().hex}"
    await db.game_sessions.insert_one({
        "game_id": game_id, "user_id": user["user_id"], "mode": body.mode,
        "used": False, "started_at": datetime.now(timezone.utc),
    })
    return {"game_id": game_id}


@api_router.post("/scores")
async def submit_score(body: ScoreSubmit, user: dict = Depends(get_current_user)):
    if body.correct > body.total:
        raise HTTPException(status_code=422, detail="correct_exceeds_total")
    if body.mode in ("t_classic", "t_time_attack") and not await _tournament_enabled():
        raise HTTPException(status_code=403, detail="tournament_closed")
    # One-time game ticket: blocks reload/duplicate submits and crafted result URLs.
    ticket = await db.game_sessions.find_one_and_update(
        {"game_id": body.game_id, "user_id": user["user_id"], "mode": body.mode, "used": False},
        {"$set": {"used": True, "used_at": datetime.now(timezone.utc)}},
    )
    if not ticket:
        raise HTTPException(status_code=409, detail="invalid_or_used_game")
    started = ticket["started_at"]
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    # Minimum realistic play time: timed modes run their full clock, question modes ~1s/answer.
    min_secs = {"time_attack": 50, "t_time_attack": 80}.get(body.mode, body.total * 0.8)
    if elapsed < min_secs:
        raise HTTPException(status_code=422, detail="game_too_fast")
    if body.mode == "classic":
        body.total = min(body.total, CLASSIC_MAX_Q)
        body.correct = min(body.correct, body.total)
    if body.mode in ("classic", "time_attack"):
        body.score = min(body.score, body.correct * NORMAL_POINT)
    if body.mode in ("t_classic", "t_time_attack"):
        return await _submit_tournament_score(body, user)
    now = datetime.now(timezone.utc)
    # ---- Streak update ----
    today = now.date()
    last_date_val = user.get("last_play_date")
    last_date = None
    if isinstance(last_date_val, datetime):
        last_date = last_date_val.date()
    elif isinstance(last_date_val, str):
        try:
            last_date = datetime.fromisoformat(last_date_val).date()
        except Exception:
            last_date = None
    current = int(user.get("current_streak", 0) or 0)
    best = int(user.get("best_streak", 0) or 0)
    streak_bonus = 0
    streak_milestone: Optional[int] = None
    prev_current = current
    if last_date == today:
        pass  # already counted today
    elif last_date == today - timedelta(days=1):
        current += 1
    else:
        current = 1
    if current > best:
        best = current
    if current != prev_current or last_date != today:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {
                "current_streak": current,
                "best_streak": best,
                "last_play_date": datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc),
            }},
        )
    # Streak bonus points (first submit of the day only)
    if last_date != today:
        if current >= 7:
            streak_bonus = 150
            streak_milestone = 7
        elif current >= 3:
            streak_bonus = 75
            streak_milestone = 3
        elif current >= 2:
            streak_bonus = 25

    final_score = int(body.score) + streak_bonus
    # Live match 2x bonus
    live_bonus = 0
    try:
        cursor = db.matches.find({"deleted_at": {"$exists": False}, "final_home": None}, {"_id": 0}).sort(
            "kickoff_at", -1
        )
        async for m in cursor:
            if _match_status(m) == "live":
                live_bonus = final_score  # doubles the score
                break
    except Exception:
        pass
    final_score += live_bonus
    doc = {
        "entry_id": f"sc_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "name": user["name"],
        "picture": user.get("picture"),
        "score": final_score,
        "base_score": int(body.score),
        "streak_bonus": streak_bonus,
        "mode": body.mode,
        "category": body.category,
        "correct": int(body.correct),
        "total": int(body.total),
        "week_key": _week_key(now),
        "created_at": now,
    }
    await db.scores.insert_one(doc)
    try:
        await _ensure_weekly_rollover()
    except Exception as e:
        logger.warning("rollover error: %s", e)
    total_score = None
    if body.mode == "classic":
        # Classic = cumulative: every finished session adds to the user's running total.
        row = await db.best_scores.find_one_and_update(
            {"user_id": user["user_id"], "mode": "classic"},
            {
                "$set": {
                    "user_id": user["user_id"],
                    "name": user["name"],
                    "picture": user.get("picture"),
                    "mode": "classic",
                    "category": body.category,
                    "created_at": doc["created_at"],
                },
                "$inc": {"score": doc["score"], "correct": doc["correct"], "total": doc["total"], "games": 1},
            },
            upsert=True,
            return_document=True,
            projection={"_id": 0},
        )
        total_score = int(row.get("score", 0))
    else:
        best = await db.best_scores.find_one(
            {"user_id": user["user_id"], "mode": body.mode}, {"_id": 0}
        )
        if (best is None) or (best.get("score", 0) < doc["score"]):
            await db.best_scores.update_one(
                {"user_id": user["user_id"], "mode": body.mode},
                {
                    "$set": {
                        "user_id": user["user_id"],
                        "name": user["name"],
                        "picture": user.get("picture"),
                        "score": doc["score"],
                        "mode": body.mode,
                        "category": body.category,
                        "correct": doc["correct"],
                        "total": doc["total"],
                        "created_at": doc["created_at"],
                    }
                },
                upsert=True,
            )
    return {"ok": True, "score": doc["score"], "total_score": total_score, "streak": current, "streak_bonus": streak_bonus, "streak_milestone": streak_milestone, "live_bonus": live_bonus}


@api_router.get("/leaderboard", response_model=List[LeaderboardEntry])
async def leaderboard(
    mode: str = "classic",
    limit: int = 50,
    scope: str = "global",
    authorization: Optional[str] = Header(default=None),
):
    query: dict = {"mode": mode}
    if scope == "friends":
        # resolve current user; if unauthenticated, empty list.
        if not authorization or not authorization.lower().startswith("bearer "):
            return []
        token = authorization.split(" ", 1)[1].strip()
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if not session:
            return []
        follows = await db.friendships.find(
            {"follower_id": session["user_id"]}, {"_id": 0, "following_id": 1}
        ).to_list(1000)
        ids = [f["following_id"] for f in follows] + [session["user_id"]]
        query["user_id"] = {"$in": ids}

    cursor = db.best_scores.find(query, {"_id": 0}).sort("score", -1).limit(limit)
    results = []
    async for doc in cursor:
        try:
            results.append(LeaderboardEntry(**doc))
        except Exception:
            # Skip a malformed row instead of failing the whole leaderboard.
            logger.warning("skipping malformed best_scores row for %s", doc.get("user_id"))
    return results


# ---------- Friends ----------
@api_router.get("/friends/search", response_model=List[FriendOut])
async def friends_search(q: str = Query(..., min_length=2), user: dict = Depends(get_current_user)):
    q_norm = q.strip().upper()
    q_email = q.strip().lower()
    cursor = db.users.find(
        {
            "user_id": {"$ne": user["user_id"]},
            "$or": [
                {"username": q_norm},
                {"email": q_email},
                {"email": {"$regex": q_email, "$options": "i"}},
                {"name": {"$regex": q.strip(), "$options": "i"}},
            ],
        },
        {"_id": 0},
    ).limit(20)
    results: List[FriendOut] = []
    async for u in cursor:
        results.append(
            FriendOut(user_id=u["user_id"], username=u.get("username", ""), name=u["name"], picture=u.get("picture"))
        )
    return results


@api_router.post("/friends/follow")
async def friends_follow(body: FollowIn, user: dict = Depends(get_current_user)):
    target = None
    if body.code:
        target = await db.users.find_one({"username": body.code.strip().upper()}, {"_id": 0})
    elif body.email:
        target = await db.users.find_one({"email": body.email.strip().lower()}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="user_not_found")
    if target["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="cannot_follow_self")
    await db.friendships.update_one(
        {"follower_id": user["user_id"], "following_id": target["user_id"]},
        {"$set": {"follower_id": user["user_id"], "following_id": target["user_id"], "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    try:
        await push_notification(
            target["user_id"],
            "follow",
            f"{user['name']} mulai mengikutimu.",
            from_user=user,
        )
    except Exception:
        pass
    return {"ok": True, "friend": FriendOut(user_id=target["user_id"], username=target.get("username", ""), name=target["name"], picture=target.get("picture"))}


@api_router.post("/friends/unfollow")
async def friends_unfollow(body: FollowIn, user: dict = Depends(get_current_user)):
    target = None
    if body.code:
        target = await db.users.find_one({"username": body.code.strip().upper()}, {"_id": 0})
    elif body.email:
        target = await db.users.find_one({"email": body.email.strip().lower()}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="user_not_found")
    await db.friendships.delete_one(
        {"follower_id": user["user_id"], "following_id": target["user_id"]}
    )
    return {"ok": True}


@api_router.get("/friends", response_model=List[FriendOut])
async def friends_list(user: dict = Depends(get_current_user)):
    follows = await db.friendships.find(
        {"follower_id": user["user_id"]}, {"_id": 0}
    ).to_list(500)
    ids = [f["following_id"] for f in follows]
    if not ids:
        return []
    cursor = db.users.find({"user_id": {"$in": ids}}, {"_id": 0})
    results: List[FriendOut] = []
    async for u in cursor:
        results.append(
            FriendOut(user_id=u["user_id"], username=u.get("username", ""), name=u["name"], picture=u.get("picture"))
        )
    return results


# ---------- Players (admin + public read) ----------
@api_router.get("/players", response_model=List[PlayerOut])
async def players_list(include_all: bool = False):
    query = {"deleted_at": None} if False else {"deleted_at": {"$exists": False}}
    if not include_all:
        query["included_in_quiz"] = True
    cursor = db.players.find(query, {"_id": 0}).sort("created_at", -1)
    results: List[PlayerOut] = []
    async for p in cursor:
        results.append(PlayerOut(**p))
    return results


@api_router.post("/admin/players", response_model=PlayerOut)
async def players_create(
    name: str = Form(...),
    position: str = Form(...),
    years_at_mu: str = Form(""),
    previous_clubs: str = Form(""),  # comma-separated
    included_in_quiz: str = Form("true"),
    photo: Optional[UploadFile] = File(None),
    user: dict = Depends(require_admin),
):
    if position not in ("GK", "DEF", "MID", "FWD"):
        raise HTTPException(status_code=422, detail="invalid_position")
    player_id = f"pl_{uuid.uuid4().hex[:12]}"
    photo_url = None
    if photo is not None:
        content = await photo.read()
        if not content:
            raise HTTPException(status_code=400, detail="empty_photo")
        ext = (photo.filename or "img.jpg").rsplit(".", 1)[-1].lower()
        if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
            ext = "jpg"
        path = f"{APP_NAME}/uploads/{user['user_id']}/{player_id}.{ext}"
        try:
            await run_in_threadpool(put_object, path, content, photo.content_type or f"image/{ext}")
        except Exception as e:
            logger.exception("photo upload failed: %s", e)
            raise HTTPException(status_code=500, detail="photo_upload_failed")
        photo_url = f"/api/files/{path}"
    clubs = [c.strip() for c in previous_clubs.split(",") if c.strip()]
    doc = {
        "player_id": player_id,
        "name": name.strip(),
        "position": position,
        "years_at_mu": years_at_mu.strip() or None,
        "previous_clubs": clubs,
        "included_in_quiz": included_in_quiz.lower() == "true",
        "photo_url": photo_url,
        "created_at": datetime.now(timezone.utc),
        "created_by": user["user_id"],
    }
    await db.players.insert_one(doc)
    return PlayerOut(**doc)


@api_router.patch("/admin/players/{player_id}")
async def players_toggle(
    player_id: str, included_in_quiz: bool, user: dict = Depends(require_admin)
):
    res = await db.players.update_one(
        {"player_id": player_id, "deleted_at": {"$exists": False}},
        {"$set": {"included_in_quiz": included_in_quiz}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="player_not_found")
    return {"ok": True}


@api_router.delete("/admin/players/{player_id}")
async def players_delete(player_id: str, user: dict = Depends(require_admin)):
    res = await db.players.update_one(
        {"player_id": player_id},
        {"$set": {"deleted_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="player_not_found")
    return {"ok": True}


# File serving — simple pass-through; path is {app_name}/uploads/{user_id}/{file}
@api_router.get("/files/{full_path:path}")
async def files_get(full_path: str):
    try:
        data, ctype = await run_in_threadpool(get_object, full_path)
    except Exception:
        raise HTTPException(status_code=404, detail="not_found")
    return Response(content=data, media_type=ctype)


# ---------- Seed demo players (admin) ----------
@api_router.post("/admin/seed-players")
async def seed_players_endpoint(user: dict = Depends(require_admin)):
    inserted = 0
    for p in SEED_PLAYERS:
        existing = await db.players.find_one(
            {"name": p["name"], "deleted_at": {"$exists": False}}, {"_id": 0}
        )
        if existing:
            continue
        doc = {
            "player_id": f"pl_{uuid.uuid4().hex[:12]}",
            "name": p["name"],
            "position": p["position"],
            "years_at_mu": p.get("years_at_mu"),
            "previous_clubs": p.get("previous_clubs", []),
            "included_in_quiz": True,
            "photo_url": None,
            "created_at": datetime.now(timezone.utc),
            "created_by": user["user_id"],
        }
        await db.players.insert_one(doc)
        inserted += 1
    return {"ok": True, "inserted": inserted, "total": await db.players.count_documents({"deleted_at": {"$exists": False}})}


# ---------- Notifications ----------
class NotificationOut(BaseModel):
    notification_id: str
    kind: str  # "follow", "badge"
    from_user_id: Optional[str] = None
    from_name: Optional[str] = None
    from_picture: Optional[str] = None
    message: str
    read: bool
    created_at: datetime


async def push_notification(user_id: str, kind: str, message: str, from_user: Optional[dict] = None):
    doc = {
        "notification_id": f"nt_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "kind": kind,
        "message": message,
        "from_user_id": from_user.get("user_id") if from_user else None,
        "from_name": from_user.get("name") if from_user else None,
        "from_picture": from_user.get("picture") if from_user else None,
        "read": False,
        "created_at": datetime.now(timezone.utc),
    }
    await db.notifications.insert_one(doc)


@api_router.get("/notifications", response_model=List[NotificationOut])
async def notifications_list(user: dict = Depends(get_current_user), limit: int = 50):
    cursor = (
        db.notifications.find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    )
    results: List[NotificationOut] = []
    async for n in cursor:
        results.append(NotificationOut(**{k: v for k, v in n.items() if k != "user_id"}))
    return results


@api_router.get("/notifications/unread-count")
async def notifications_unread(user: dict = Depends(get_current_user)):
    count = await db.notifications.count_documents({"user_id": user["user_id"], "read": False})
    return {"count": count}


@api_router.post("/notifications/read-all")
async def notifications_read_all(user: dict = Depends(get_current_user)):
    await db.notifications.update_many(
        {"user_id": user["user_id"], "read": False}, {"$set": {"read": True}}
    )
    return {"ok": True}


# ---------- Weekly leaderboard & badges ----------
def _week_key(dt: datetime) -> str:
    iso = dt.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


async def _ensure_weekly_rollover():
    """When a new ISO week starts, freeze last week's top-3 into badges collection."""
    now = datetime.now(timezone.utc)
    cur_key = _week_key(now)
    setting = await db.app_settings.find_one({"_key": "weekly"}, {"_id": 0})
    last_key = setting.get("current_week_key") if setting else None
    if last_key == cur_key:
        return
    if last_key:
        # Snapshot top-3 per mode for last_key.
        for mode in ("classic", "time_attack"):
            if mode == "classic":
                ranked = await _weekly_classic_totals(last_key, 3)
            else:
                ranked = await db.scores.find(
                    {"mode": mode, "week_key": last_key}, {"_id": 0}
                ).sort("score", -1).to_list(500)
            seen = set()
            rank = 0
            for s in ranked:
                if s["user_id"] in seen:
                    continue
                seen.add(s["user_id"])
                rank += 1
                if rank > 3:
                    break
                await db.badges.update_one(
                    {"user_id": s["user_id"], "week_key": last_key, "mode": mode, "rank": rank},
                    {
                        "$set": {
                            "badge_id": f"bg_{uuid.uuid4().hex[:12]}",
                            "user_id": s["user_id"],
                            "week_key": last_key,
                            "mode": mode,
                            "rank": rank,
                            "score": s["score"],
                            "created_at": datetime.now(timezone.utc),
                        }
                    },
                    upsert=True,
                )
                # Rank-1 champions get exclusive skin for 7 days.
                if rank == 1:
                    await db.users.update_one(
                        {"user_id": s["user_id"]},
                        {"$set": {"champion_until": datetime.now(timezone.utc) + timedelta(days=7)}},
                    )
                try:
                    label = {1: "🥇 Juara 1", 2: "🥈 Juara 2", 3: "🥉 Juara 3"}[rank]
                    mode_label = "Classic" if mode == "classic" else "Time Attack"
                    extra = " · Skin CHAMPION aktif 7 hari!" if rank == 1 else ""
                    await push_notification(
                        s["user_id"],
                        "badge",
                        f"{label} {mode_label} minggu {last_key}! Skor {s['score']}{extra}",
                    )
                except Exception:
                    pass
    await db.app_settings.update_one(
        {"_key": "weekly"},
        {"$set": {"_key": "weekly", "current_week_key": cur_key, "updated_at": now}},
        upsert=True,
    )


@api_router.get("/leaderboard/weekly", response_model=List[LeaderboardEntry])
async def weekly_leaderboard(mode: str = "classic", limit: int = 50):
    await _ensure_weekly_rollover()
    cur_key = _week_key(datetime.now(timezone.utc))
    # Highest score per user within current week.
    if mode == "classic":
        rows = await _weekly_classic_totals(cur_key, limit)
        return [LeaderboardEntry(**r) for r in rows]
    cursor = db.scores.find({"mode": mode, "week_key": cur_key}, {"_id": 0}).sort("score", -1)
    best_per_user: dict[str, dict] = {}
    async for s in cursor:
        uid = s["user_id"]
        if uid not in best_per_user:
            best_per_user[uid] = s
    results = [LeaderboardEntry(**v) for v in list(best_per_user.values())[:limit]]
    return results


async def _weekly_classic_totals(week_key: str, limit: int = 50) -> list:
    """Classic weekly board = sum of every Classic session played that week."""
    pipeline = [
        {"$match": {"mode": "classic", "week_key": week_key}},
        {"$sort": {"created_at": 1}},
        {"$group": {
            "_id": "$user_id",
            "name": {"$last": "$name"},
            "picture": {"$last": "$picture"},
            "category": {"$last": "$category"},
            "score": {"$sum": "$score"},
            "correct": {"$sum": "$correct"},
            "total": {"$sum": "$total"},
            "games": {"$sum": 1},
            "created_at": {"$last": "$created_at"},
        }},
        {"$sort": {"score": -1}},
        {"$limit": limit},
    ]
    out = []
    async for r in db.scores.aggregate(pipeline):
        r["user_id"] = r.pop("_id")
        r["mode"] = "classic"
        out.append(r)
    return out


class BadgeOut(BaseModel):
    badge_id: str
    week_key: str
    mode: str
    rank: int
    score: int
    created_at: datetime


class ChallengeCreate(BaseModel):
    score: int
    mode: Literal["classic", "time_attack"]
    category: str
    theme_id: Optional[str] = None


class ChallengeComplete(BaseModel):
    score: int


class ChallengeOut(BaseModel):
    challenge_id: str
    from_user_id: str
    from_name: str
    from_picture: Optional[str] = None
    score_to_beat: int
    mode: str
    category: str
    theme_id: Optional[str] = None
    created_at: datetime


class MatchIn(BaseModel):
    opponent: str
    kickoff_at: datetime  # UTC
    home: bool = True  # Madura United at home?
    competition: Optional[str] = "Liga 1"


class MatchResult(BaseModel):
    final_home: int = Field(ge=0, le=99)
    final_away: int = Field(ge=0, le=99)
    scorer_player_ids: List[str] = Field(default_factory=list)
    motm_player_id: Optional[str] = None


class MatchOut(BaseModel):
    match_id: str
    opponent: str
    kickoff_at: datetime
    home: bool
    competition: Optional[str] = None
    final_home: Optional[int] = None
    final_away: Optional[int] = None
    scorer_player_ids: List[str] = Field(default_factory=list)
    motm_player_id: Optional[str] = None
    status: str  # "upcoming" | "live" | "finished"


class PredictionIn(BaseModel):
    pred_home: int
    pred_away: int
    scorer_player_id: Optional[str] = None
    motm_player_id: Optional[str] = None


class PredictionOut(BaseModel):
    prediction_id: str
    match_id: str
    pred_home: int
    pred_away: int
    scorer_player_id: Optional[str] = None
    motm_player_id: Optional[str] = None
    scorer_name: Optional[str] = None
    motm_name: Optional[str] = None
    points: Optional[int] = None
    user_id: str
    name: str
    picture: Optional[str] = None


@api_router.get("/me/badges", response_model=List[BadgeOut])
async def my_badges(user: dict = Depends(get_current_user), limit: int = 30):
    cursor = (
        db.badges.find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    )
    results: List[BadgeOut] = []
    async for b in cursor:
        results.append(BadgeOut(**{k: v for k, v in b.items() if k in BadgeOut.model_fields}))
    return results


# ---------- Streak ----------
@api_router.get("/me/streak")
async def my_streak(user: dict = Depends(get_current_user)):
    last = user.get("last_play_date")
    if isinstance(last, datetime) and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return {
        "current_streak": int(user.get("current_streak", 0) or 0),
        "best_streak": int(user.get("best_streak", 0) or 0),
        "last_play_date": last.isoformat() if isinstance(last, datetime) else None,
    }


# ---------- Weekly Theme ----------
@api_router.get("/weekly-theme")
async def weekly_theme():
    cur_key = _week_key(datetime.now(timezone.utc))
    theme = pick_theme_for_week(cur_key)
    return {"week_key": cur_key, **theme}


# ---------- Available skins (base 3 + champion if active) ----------
@api_router.get("/me/skins")
async def my_skins(user: dict = Depends(get_current_user)):
    champ = user.get("champion_until")
    if isinstance(champ, datetime) and champ.tzinfo is None:
        champ = champ.replace(tzinfo=timezone.utc)
    champ_active = isinstance(champ, datetime) and champ > datetime.now(timezone.utc)
    return {
        "home": {"locked": False},
        "away": {"locked": False},
        "third": {"locked": False},
        "champion": {
            "locked": not champ_active,
            "until": champ.isoformat() if (champ_active and isinstance(champ, datetime)) else None,
        },
    }


# ---------- Rematch Challenges ----------
@api_router.post("/challenges/create", response_model=ChallengeOut)
async def challenges_create(body: ChallengeCreate, user: dict = Depends(get_current_user)):
    doc = {
        "challenge_id": f"ch_{uuid.uuid4().hex[:12]}",
        "from_user_id": user["user_id"],
        "from_name": user["name"],
        "from_picture": user.get("picture"),
        "score_to_beat": int(body.score),
        "mode": body.mode,
        "category": body.category,
        "theme_id": body.theme_id,
        "created_at": datetime.now(timezone.utc),
    }
    await db.challenges.insert_one(doc)
    return ChallengeOut(**{k: v for k, v in doc.items() if k in ChallengeOut.model_fields})


# ---------- Top Streaks (public widget) ----------
class StreakLeader(BaseModel):
    user_id: str
    name: str
    picture: Optional[str] = None
    username: str
    current_streak: int
    best_streak: int


XP_PER_LEVEL = 500


async def _user_xp(uid: str) -> int:
    """Total points across all modes (Classic total, Time Attack best, predictions, Tournament)."""
    xp = 0
    async for b in db.best_scores.find({"user_id": uid}, {"_id": 0, "score": 1}):
        xp += int(b.get("score", 0) or 0)
    async for t in db.tournament_boards.find({"user_id": uid, "board": {"$in": ["classic", "time_attack"]}}, {"_id": 0, "score": 1}):
        xp += int(t.get("score", 0) or 0)
    async for r in db.predictions.aggregate([
        {"$match": {"user_id": uid, "points": {"$gt": 0}}},
        {"$group": {"_id": None, "s": {"$sum": "$points"}}},
    ]):
        xp += int(r.get("s", 0) or 0)
    f = await db.f100_board.find_one({"user_id": uid}, {"_id": 0, "score": 1})
    xp += int((f or {}).get("score", 0) or 0)
    # Tournament points banked at each event reset so XP/level never drops.
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "xp_banked": 1})
    xp += int((u or {}).get("xp_banked", 0) or 0)
    return xp


@api_router.get("/me/xp")
async def my_xp(user: dict = Depends(get_current_user)):
    xp = await _user_xp(user["user_id"])
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "xp_spent": 1})
    spent = int((fresh or {}).get("xp_spent", 0) or 0)
    best = {"classic": 0, "time_attack": 0}
    async for b in db.best_scores.find({"user_id": user["user_id"]}, {"_id": 0, "mode": 1, "score": 1}):
        if b.get("mode") in best:
            best[b["mode"]] = int(b.get("score", 0) or 0)
    return {
        "xp": xp, "level": xp // XP_PER_LEVEL + 1, "level_xp": xp % XP_PER_LEVEL, "level_size": XP_PER_LEVEL,
        "spent": spent, "balance": max(0, xp - spent), "best": best,
    }


# ---------- Profile settings (name + photo, photo once per 7 days) ----------
AVATAR_COOLDOWN_DAYS = 7


class ProfileNameIn(BaseModel):
    name: str = Field(min_length=2, max_length=30)


def _aware(dt):
    return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt


@api_router.get("/me/profile-settings")
async def profile_settings(user: dict = Depends(get_current_user)):
    last = _aware(user.get("avatar_changed_at"))
    next_at = last + timedelta(days=AVATAR_COOLDOWN_DAYS) if last else None
    can = next_at is None or datetime.now(timezone.utc) >= next_at
    return {"name": user["name"], "picture": user.get("picture"), "can_change_photo": can,
            "next_photo_change_at": None if can else next_at}


@api_router.put("/me/profile")
async def profile_update_name(body: ProfileNameIn, user: dict = Depends(get_current_user)):
    name = re.sub(r"\s+", " ", body.name).strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="invalid_name")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"name": name, "custom_name": True}})
    return {"ok": True, "name": name}


@api_router.post("/me/avatar")
async def profile_update_avatar(request: Request, image: UploadFile = File(...), user: dict = Depends(get_current_user)):
    last = _aware(user.get("avatar_changed_at"))
    if last and datetime.now(timezone.utc) < last + timedelta(days=AVATAR_COOLDOWN_DAYS):
        raise HTTPException(status_code=429, detail="photo_cooldown")
    content = await image.read()
    if not content or len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="invalid_image")
    ext = (image.filename or "avatar.jpg").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{user['user_id']}/avatar_{uuid.uuid4().hex[:8]}.{ext}"
    try:
        await run_in_threadpool(put_object, path, content, image.content_type or f"image/{ext}")
    except Exception as e:
        logger.exception("avatar upload failed: %s", e)
        raise HTTPException(status_code=500, detail="avatar_upload_failed")
    # Pictures are rendered directly by clients, so store an absolute URL of this deployment.
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    proto = request.headers.get("x-forwarded-proto", "https")
    url = f"{proto}://{host}/api/files/{path}"
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"picture": url, "custom_picture": True, "avatar_changed_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "picture": url}


# ---------- Store (Futcards redeemed with XP balance) ----------
class StoreCardOut(BaseModel):
    card_id: str
    title: str
    image_url: Optional[str] = None
    price: int
    stock: int
    active: bool = True
    order_index: int = 0


def _card_out(d: dict) -> StoreCardOut:
    return StoreCardOut(**{k: d.get(k) for k in StoreCardOut.model_fields if d.get(k) is not None})


def _trim_transparent(content: bytes) -> bytes:
    """Crop empty transparent margins so full-body characters fill their frame."""
    try:
        from PIL import Image as PILImage
        im = PILImage.open(io.BytesIO(content))
        if im.mode not in ("RGBA", "LA", "P"):
            return content
        im = im.convert("RGBA")
        box = im.getchannel("A").getbbox()
        if not box or box == (0, 0, im.width, im.height):
            return content
        pad = int(max(box[2] - box[0], box[3] - box[1]) * 0.02)
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad))
        im = im.crop(box)
        # Cap the size so the lobby loads fast on phones.
        if im.height > 1400:
            im = im.resize((max(1, round(im.width * 1400 / im.height)), 1400), PILImage.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="PNG", optimize=True)
        return out.getvalue()
    except Exception as e:
        logger.warning("trim failed: %s", e)
        return content


async def _store_image(user: dict, image: Optional[UploadFile], card_id: str, trim: bool = False) -> Optional[str]:
    if image is None:
        return None
    content = await image.read()
    if not content:
        return None
    ext = (image.filename or "card.png").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
        ext = "png"
    ctype = image.content_type or f"image/{ext}"
    if trim:
        trimmed = await run_in_threadpool(_trim_transparent, content)
        if trimmed is not content:
            content, ext, ctype = trimmed, "png", "image/png"
    path = f"{APP_NAME}/uploads/{user['user_id']}/card_{card_id}_{uuid.uuid4().hex[:6]}.{ext}"
    try:
        await run_in_threadpool(put_object, path, content, ctype)
    except Exception as e:
        logger.exception("card upload failed: %s", e)
        raise HTTPException(status_code=500, detail="card_upload_failed")
    return f"/api/files/{path}"


@api_router.get("/store/cards", response_model=List[StoreCardOut])
async def store_cards():
    cur = db.store_cards.find({"active": True, "deleted_at": {"$exists": False}}, {"_id": 0}).sort(
        [("order_index", 1), ("created_at", 1)])
    return [_card_out(d) async for d in cur]


@api_router.get("/admin/store/cards", response_model=List[StoreCardOut])
async def store_cards_admin(user: dict = Depends(require_admin)):
    cur = db.store_cards.find({"deleted_at": {"$exists": False}}, {"_id": 0}).sort(
        [("order_index", 1), ("created_at", 1)])
    return [_card_out(d) async for d in cur]


@api_router.post("/admin/store/cards", response_model=StoreCardOut)
async def store_card_create(
    title: str = Form(...),
    price: int = Form(...),
    stock: int = Form(...),
    active: bool = Form(True),
    image: Optional[UploadFile] = File(None),
    user: dict = Depends(require_admin),
):
    if not title.strip() or price < 0 or stock < 0:
        raise HTTPException(status_code=422, detail="invalid_card")
    card_id = f"sc_{uuid.uuid4().hex[:12]}"
    count = await db.store_cards.count_documents({"deleted_at": {"$exists": False}})
    doc = {
        "card_id": card_id, "title": title.strip()[:40], "price": int(price), "stock": int(stock),
        "active": bool(active), "order_index": count, "image_url": await _store_image(user, image, card_id),
        "created_at": datetime.now(timezone.utc),
    }
    await db.store_cards.insert_one(doc)
    return _card_out(doc)


@api_router.put("/admin/store/cards/{card_id}", response_model=StoreCardOut)
async def store_card_update(
    card_id: str,
    title: Optional[str] = Form(None),
    price: Optional[int] = Form(None),
    stock: Optional[int] = Form(None),
    active: Optional[bool] = Form(None),
    image: Optional[UploadFile] = File(None),
    user: dict = Depends(require_admin),
):
    upd: dict = {"updated_at": datetime.now(timezone.utc)}
    if title is not None and title.strip():
        upd["title"] = title.strip()[:40]
    if price is not None:
        if price < 0:
            raise HTTPException(status_code=422, detail="invalid_price")
        upd["price"] = int(price)
    if stock is not None:
        if stock < 0:
            raise HTTPException(status_code=422, detail="invalid_stock")
        upd["stock"] = int(stock)
    if active is not None:
        upd["active"] = bool(active)
    img = await _store_image(user, image, card_id)
    if img:
        upd["image_url"] = img
    doc = await db.store_cards.find_one_and_update(
        {"card_id": card_id, "deleted_at": {"$exists": False}}, {"$set": upd},
        return_document=True, projection={"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="card_not_found")
    return _card_out(doc)


@api_router.delete("/admin/store/cards/{card_id}")
async def store_card_delete(card_id: str, user: dict = Depends(require_admin)):
    res = await db.store_cards.update_one({"card_id": card_id}, {"$set": {"deleted_at": datetime.now(timezone.utc)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="card_not_found")
    return {"ok": True}


@api_router.post("/store/cards/{card_id}/redeem")
async def store_card_redeem(card_id: str, user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    card = await db.store_cards.find_one({"card_id": card_id, "active": True, "deleted_at": {"$exists": False}}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="card_not_found")
    if await db.user_cards.find_one({"user_id": uid, "card_id": card_id}):
        raise HTTPException(status_code=409, detail="already_owned")
    price = int(card["price"])
    xp = await _user_xp(uid)
    # Reserve the XP atomically: only succeeds if balance still covers the price.
    paid = await db.users.find_one_and_update(
        {"user_id": uid, "$expr": {"$lte": [{"$add": [{"$ifNull": ["$xp_spent", 0]}, price]}, xp]}},
        {"$inc": {"xp_spent": price}},
    )
    if not paid:
        raise HTTPException(status_code=402, detail="insufficient_balance")
    taken = await db.store_cards.find_one_and_update(
        {"card_id": card_id, "stock": {"$gt": 0}}, {"$inc": {"stock": -1}})
    if not taken:
        await db.users.update_one({"user_id": uid}, {"$inc": {"xp_spent": -price}})
        raise HTTPException(status_code=410, detail="out_of_stock")
    try:
        await db.user_cards.insert_one({
            "user_id": uid, "card_id": card_id, "title": card["title"], "image_url": card.get("image_url"),
            "price": price, "redeemed_at": datetime.now(timezone.utc),
        })
    except Exception:
        # duplicate (double tap race) -> refund
        await db.users.update_one({"user_id": uid}, {"$inc": {"xp_spent": -price}})
        await db.store_cards.update_one({"card_id": card_id}, {"$inc": {"stock": 1}})
        raise HTTPException(status_code=409, detail="already_owned")
    return {"ok": True, "balance": max(0, xp - int((paid.get("xp_spent", 0) or 0)) - price)}


@api_router.get("/me/cards")
async def my_cards(user: dict = Depends(get_current_user)):
    cur = db.user_cards.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("redeemed_at", 1)
    return [d async for d in cur]


# ---------- Admin: gift Futcards to users (tournament prizes) ----------
class GiftCardIn(BaseModel):
    card_id: str


@api_router.get("/admin/users/search")
async def admin_user_search(q: str = "", user: dict = Depends(require_admin)):
    q = q.strip()
    if len(q) < 2:
        return []
    rx = {"$regex": re.escape(q), "$options": "i"}
    cur = db.users.find({"$or": [{"name": rx}, {"username": rx}, {"email": rx}]},
                        {"_id": 0, "user_id": 1, "name": 1, "username": 1, "email": 1, "picture": 1}).limit(20)
    return [u async for u in cur]


@api_router.post("/admin/users/{user_id}/gift-card")
async def admin_gift_card(user_id: str, body: GiftCardIn, user: dict = Depends(require_admin)):
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="user_not_found")
    card = await db.store_cards.find_one({"card_id": body.card_id, "deleted_at": {"$exists": False}}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="card_not_found")
    if await db.user_cards.find_one({"user_id": user_id, "card_id": body.card_id}):
        raise HTTPException(status_code=409, detail="already_owned")
    await db.user_cards.insert_one({
        "user_id": user_id, "card_id": body.card_id, "title": card["title"], "image_url": card.get("image_url"),
        "price": 0, "gifted": True, "gifted_by": user["user_id"], "redeemed_at": datetime.now(timezone.utc),
    })
    try:
        await push_notification(user_id, "gift_card", f"Selamat! Kamu mendapat kartu {card['title']} dari admin 🎁", from_user=user)
    except Exception:
        pass
    return {"ok": True}


# ---------- Football 100 (order the 4 correct answers) ----------
F100_QUESTIONS = 10
F100_SECONDS = 30
F100_PERFECT = 100
F100_PER_HIT = 10


class F100ItemIn(BaseModel):
    prompt: str = Field(min_length=3, max_length=300)
    answers: List[str] = Field(min_length=4, max_length=4)  # correct order
    wrong: List[str] = Field(min_length=4, max_length=4)  # 4 distractors
    active: bool = True


class F100ItemOut(BaseModel):
    item_id: str
    prompt: str
    answers: List[str]
    wrong: List[str]
    active: bool
    order_index: int


def _f100_out(d: dict) -> F100ItemOut:
    return F100ItemOut(**{k: d.get(k) for k in F100ItemOut.model_fields})


def _f100_validate(answers: List[str], wrong: List[str]):
    a = [x.strip() for x in answers]
    w = [x.strip() for x in wrong]
    if any(not x for x in a + w) or len({x.lower() for x in a + w}) != 8:
        raise HTTPException(status_code=422, detail="need_8_unique_options")
    return a, w


@api_router.get("/admin/f100/items", response_model=List[F100ItemOut])
async def f100_admin_list(user: dict = Depends(require_admin)):
    cur = db.f100_items.find({"deleted_at": {"$exists": False}}, {"_id": 0}).sort("order_index", 1)
    return [_f100_out(d) async for d in cur]


@api_router.post("/admin/f100/items", response_model=F100ItemOut)
async def f100_create(body: F100ItemIn, user: dict = Depends(require_admin)):
    a, w = _f100_validate(body.answers, body.wrong)
    last = await db.f100_items.find_one({"deleted_at": {"$exists": False}}, sort=[("order_index", -1)])
    doc = {"item_id": f"f1_{uuid.uuid4().hex[:12]}", "prompt": body.prompt.strip(), "answers": a, "wrong": w,
           "active": body.active, "order_index": (last["order_index"] + 1) if last else 0,
           "created_at": datetime.now(timezone.utc)}
    await db.f100_items.insert_one(doc)
    return _f100_out(doc)


@api_router.put("/admin/f100/items/{item_id}", response_model=F100ItemOut)
async def f100_update(item_id: str, body: F100ItemIn, user: dict = Depends(require_admin)):
    a, w = _f100_validate(body.answers, body.wrong)
    doc = await db.f100_items.find_one_and_update(
        {"item_id": item_id, "deleted_at": {"$exists": False}},
        {"$set": {"prompt": body.prompt.strip(), "answers": a, "wrong": w, "active": body.active,
                  "updated_at": datetime.now(timezone.utc)}},
        return_document=True, projection={"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="not_found")
    return _f100_out(doc)


@api_router.delete("/admin/f100/items/{item_id}")
async def f100_delete(item_id: str, user: dict = Depends(require_admin)):
    r = await db.f100_items.update_one({"item_id": item_id}, {"$set": {"deleted_at": datetime.now(timezone.utc)}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="not_found")
    return {"ok": True}


@api_router.post("/admin/f100/import")
async def f100_import(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    """CSV columns: prompt, answer_1..answer_4 (correct order), wrong_1..wrong_4, [active]."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty_file")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    try:
        delimiter = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;\t").delimiter
    except Exception:
        delimiter = ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    cols = ["prompt"] + [f"answer_{i}" for i in range(1, 5)] + [f"wrong_{i}" for i in range(1, 5)]
    if not reader.fieldnames or not set(cols).issubset({c.strip().lower() for c in reader.fieldnames}):
        raise HTTPException(status_code=422, detail=f"missing_columns:{','.join(cols)}")
    docs, errors = [], []
    for i, row in enumerate(reader, start=2):
        n = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if k}
        a = [n.get(f"answer_{j}", "") for j in range(1, 5)]
        w = [n.get(f"wrong_{j}", "") for j in range(1, 5)]
        if not n.get("prompt") or any(not x for x in a + w) or len({x.lower() for x in a + w}) != 8:
            errors.append(f"Baris {i}: butuh prompt + 8 jawaban unik.")
            continue
        docs.append({
            "item_id": f"f1_{uuid.uuid4().hex[:12]}", "prompt": n["prompt"][:300], "answers": a, "wrong": w,
            "active": n.get("active", "true").lower() not in ("false", "0", "no", "tidak"),
            "order_index": len(docs), "created_at": datetime.now(timezone.utc),
        })
    if docs:
        # Imported rows go to the top of the admin list; existing items shift down.
        await db.f100_items.update_many({"deleted_at": {"$exists": False}}, {"$inc": {"order_index": len(docs)}})
        await db.f100_items.insert_many(docs)
    return {"created": len(docs), "skipped": len(errors), "errors": errors[:20]}


@api_router.post("/f100/start")
async def f100_start(user: dict = Depends(get_current_user)):
    items = await db.f100_items.aggregate([
        {"$match": {"active": True, "deleted_at": {"$exists": False}}},
        {"$sample": {"size": F100_QUESTIONS}},
        {"$project": {"_id": 0}},
    ]).to_list(F100_QUESTIONS)
    if not items:
        raise HTTPException(status_code=404, detail="no_questions")
    game_id = f"f1g_{uuid.uuid4().hex}"
    await db.f100_sessions.insert_one({"game_id": game_id, "user_id": user["user_id"],
                                       "item_ids": [i["item_id"] for i in items], "used": False,
                                       "started_at": datetime.now(timezone.utc)})
    out = []
    for it in items:
        opts = it["answers"] + it["wrong"]
        random.shuffle(opts)
        out.append({"item_id": it["item_id"], "prompt": it["prompt"], "options": opts})
    return {"game_id": game_id, "seconds": F100_SECONDS, "questions": out}


class F100Answer(BaseModel):
    item_id: str
    picks: List[str] = Field(max_length=4)
    time_ms: int = Field(ge=0, le=F100_SECONDS * 1000 + 2000)


class F100SubmitIn(BaseModel):
    game_id: str
    answers: List[F100Answer] = Field(max_length=F100_QUESTIONS)


def _f100_score(key: List[str], picks: List[str]) -> tuple:
    norm = [p.strip().lower() for p in picks]
    k = [x.strip().lower() for x in key]
    if norm == k:
        return F100_PERFECT, 4
    hits = len({p for p in norm if p in k})
    return hits * F100_PER_HIT, hits


@api_router.post("/f100/submit")
async def f100_submit(body: F100SubmitIn, user: dict = Depends(get_current_user)):
    sess = await db.f100_sessions.find_one_and_update(
        {"game_id": body.game_id, "user_id": user["user_id"], "used": False}, {"$set": {"used": True}})
    if not sess:
        raise HTTPException(status_code=409, detail="invalid_or_used_game")
    keys = {d["item_id"]: d["answers"] async for d in db.f100_items.find(
        {"item_id": {"$in": sess["item_ids"]}}, {"_id": 0, "item_id": 1, "answers": 1})}
    total, hits, perfect, time_ms, results, seen = 0, 0, 0, 0, [], set()
    for a in body.answers:
        if a.item_id not in keys or a.item_id in seen:
            continue
        seen.add(a.item_id)
        pts, h = _f100_score(keys[a.item_id], a.picks)
        total += pts
        hits += h
        perfect += 1 if pts == F100_PERFECT else 0
        time_ms += min(a.time_ms, F100_SECONDS * 1000)
        results.append({"item_id": a.item_id, "points": pts, "hits": h, "key": keys[a.item_id]})
    # Never report more time than really passed since the game started.
    started = _aware(sess["started_at"])
    time_ms = min(time_ms, int((datetime.now(timezone.utc) - started).total_seconds() * 1000))
    slots = len(sess["item_ids"]) * 4
    now = datetime.now(timezone.utc)
    row = await db.f100_board.find_one_and_update(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "name": user["name"], "picture": user.get("picture"), "updated_at": now},
         "$inc": {"score": total, "attempts": 1, "time_ms": time_ms, "hits": hits, "slots": slots, "perfect": perfect}},
        upsert=True, return_document=True, projection={"_id": 0})
    higher = await db.f100_board.count_documents({"score": {"$gt": row["score"]}})
    return {"ok": True, "score": total, "hits": hits, "slots": slots, "perfect": perfect, "time_ms": time_ms,
            "total_score": row["score"], "rank": higher + 1, "results": results}


@api_router.get("/f100/leaderboard")
async def f100_leaderboard(limit: int = 100):
    cur = db.f100_board.find({"attempts": {"$gt": 0}}, {"_id": 0}).sort([("score", -1), ("time_ms", 1)]).limit(max(1, min(limit, 200)))
    out = []
    async for d in cur:
        slots = int(d.get("slots", 0) or 0)
        out.append({"user_id": d["user_id"], "name": d.get("name"), "picture": d.get("picture"),
                    "score": int(d.get("score", 0)), "attempts": int(d.get("attempts", 0)),
                    "time_ms": int(d.get("time_ms", 0)), "perfect": int(d.get("perfect", 0)),
                    "accuracy": round(100 * int(d.get("hits", 0)) / slots, 1) if slots else 0.0})
    return out


# ---------- Dressing Room (layered PNG wardrobe) ----------
WARDROBE_KINDS = ("character", "top", "bottom", "shoes")


class WardrobeItemOut(BaseModel):
    item_id: str
    kind: str
    name: str
    image_url: str
    back_url: Optional[str] = None  # optional back view used when the character is rotated
    order_index: int = 0


class OutfitIn(BaseModel):
    character_id: Optional[str] = None
    top_id: Optional[str] = None
    bottom_id: Optional[str] = None
    shoes_id: Optional[str] = None


def _wi_out(d: dict) -> WardrobeItemOut:
    return WardrobeItemOut(**{k: d.get(k) for k in WardrobeItemOut.model_fields if d.get(k) is not None})


@api_router.get("/wardrobe", response_model=List[WardrobeItemOut])
async def wardrobe_list():
    cur = db.wardrobe_items.find({"deleted_at": {"$exists": False}}, {"_id": 0}).sort([("kind", 1), ("order_index", 1)])
    return [_wi_out(d) async for d in cur]


@api_router.post("/admin/wardrobe", response_model=WardrobeItemOut)
async def wardrobe_create(
    kind: str = Form(...),
    name: str = Form(""),
    image: UploadFile = File(...),
    back_image: Optional[UploadFile] = File(None),
    user: dict = Depends(require_admin),
):
    if kind not in WARDROBE_KINDS:
        raise HTTPException(status_code=422, detail="invalid_kind")
    item_id = f"wd_{uuid.uuid4().hex[:12]}"
    url = await _store_image(user, image, item_id, trim=kind == "character")
    if not url:
        raise HTTPException(status_code=400, detail="empty_image")
    count = await db.wardrobe_items.count_documents({"kind": kind, "deleted_at": {"$exists": False}})
    doc = {"item_id": item_id, "kind": kind, "name": (name or kind).strip()[:40], "image_url": url,
           "back_url": await _store_image(user, back_image, item_id + "b"), "order_index": count,
           "created_at": datetime.now(timezone.utc)}
    await db.wardrobe_items.insert_one(doc)
    return _wi_out(doc)


@api_router.post("/admin/wardrobe/{item_id}/back", response_model=WardrobeItemOut)
async def wardrobe_set_back(item_id: str, image: UploadFile = File(...), user: dict = Depends(require_admin)):
    if not await db.wardrobe_items.find_one({"item_id": item_id, "deleted_at": {"$exists": False}}):
        raise HTTPException(status_code=404, detail="not_found")
    url = await _store_image(user, image, item_id + "b")
    if not url:
        raise HTTPException(status_code=400, detail="empty_image")
    doc = await db.wardrobe_items.find_one_and_update(
        {"item_id": item_id, "deleted_at": {"$exists": False}}, {"$set": {"back_url": url}},
        projection={"_id": 0}, return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="not_found")
    return _wi_out(doc)


@api_router.delete("/admin/wardrobe/{item_id}/back", response_model=WardrobeItemOut)
async def wardrobe_clear_back(item_id: str, user: dict = Depends(require_admin)):
    doc = await db.wardrobe_items.find_one_and_update(
        {"item_id": item_id, "deleted_at": {"$exists": False}}, {"$set": {"back_url": None}},
        projection={"_id": 0}, return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="not_found")
    return _wi_out(doc)


@api_router.delete("/admin/wardrobe/{item_id}")
async def wardrobe_delete(item_id: str, user: dict = Depends(require_admin)):
    r = await db.wardrobe_items.update_one({"item_id": item_id}, {"$set": {"deleted_at": datetime.now(timezone.utc)}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="not_found")
    return {"ok": True}


@api_router.get("/me/outfit")
async def outfit_get(user: dict = Depends(get_current_user)):
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "outfit": 1})
    return (fresh or {}).get("outfit") or {}


@api_router.put("/me/outfit")
async def outfit_save(body: OutfitIn, user: dict = Depends(get_current_user)):
    want = {"character_id": "character", "top_id": "top", "bottom_id": "bottom", "shoes_id": "shoes"}
    outfit = {}
    for field, kind in want.items():
        v = getattr(body, field)
        if v:
            if not await db.wardrobe_items.find_one({"item_id": v, "kind": kind, "deleted_at": {"$exists": False}}):
                raise HTTPException(status_code=422, detail=f"invalid_{field}")
            outfit[field] = v
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"outfit": outfit}})
    return outfit


@api_router.get("/top-streaks", response_model=List[StreakLeader])
async def top_streaks(limit: int = 5):
    cursor = (
        db.users.find({"current_streak": {"$gt": 0}}, {"_id": 0})
        .sort("current_streak", -1)
        .limit(limit)
    )
    results: List[StreakLeader] = []
    async for u in cursor:
        results.append(
            StreakLeader(
                user_id=u["user_id"],
                name=u["name"],
                picture=u.get("picture"),
                username=u.get("username", ""),
                current_streak=int(u.get("current_streak", 0) or 0),
                best_streak=int(u.get("best_streak", 0) or 0),
            )
        )
    return results


# ---------- Matches & Predictions ----------
LIVE_WINDOW_MIN = 110  # kickoff + 110 min = live window


def _match_status(m: dict) -> str:
    now = datetime.now(timezone.utc)
    kickoff = m["kickoff_at"]
    if isinstance(kickoff, datetime) and kickoff.tzinfo is None:
        kickoff = kickoff.replace(tzinfo=timezone.utc)
    if m.get("final_home") is not None and m.get("final_away") is not None:
        return "finished"
    if kickoff <= now <= kickoff + timedelta(minutes=LIVE_WINDOW_MIN):
        return "live"
    return "upcoming" if now < kickoff else "finished"


def _match_to_out(m: dict) -> MatchOut:
    return MatchOut(
        match_id=m["match_id"],
        opponent=m["opponent"],
        kickoff_at=m["kickoff_at"],
        home=bool(m.get("home", True)),
        competition=m.get("competition"),
        final_home=m.get("final_home"),
        final_away=m.get("final_away"),
        scorer_player_ids=m.get("scorer_player_ids", []) or [],
        motm_player_id=m.get("motm_player_id"),
        status=_match_status(m),
    )


@api_router.get("/matches", response_model=List[MatchOut])
async def matches_list():
    cursor = db.matches.find({"deleted_at": {"$exists": False}}, {"_id": 0}).sort("kickoff_at", -1)
    results: List[MatchOut] = []
    async for m in cursor:
        results.append(_match_to_out(m))
    return results


@api_router.post("/admin/matches", response_model=MatchOut)
async def matches_create(body: MatchIn, user: dict = Depends(require_admin)):
    doc = {
        "match_id": f"mt_{uuid.uuid4().hex[:12]}",
        "opponent": body.opponent.strip(),
        "kickoff_at": body.kickoff_at.astimezone(timezone.utc) if body.kickoff_at.tzinfo else body.kickoff_at.replace(tzinfo=timezone.utc),
        "home": body.home,
        "competition": body.competition,
        "final_home": None,
        "final_away": None,
        "created_at": datetime.now(timezone.utc),
        "created_by": user["user_id"],
    }
    await db.matches.insert_one(doc)
    return _match_to_out(doc)


WIB = timezone(timedelta(hours=7))


def _parse_kickoff(date_s: str, time_s: str) -> Optional[datetime]:
    """Parse a WIB date + time from CSV (YYYY-MM-DD or DD/MM/YYYY, HH:MM) into UTC."""
    s = f"{date_s.strip()} {(time_s or '').strip() or '19:00'}".replace("T", " ").replace(".", ":")
    for fmt in ("%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M", "%d-%m-%Y %H:%M", "%Y/%m/%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=WIB).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


@api_router.post("/admin/matches/import")
async def matches_import(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    """CSV columns: opponent, date, time (WIB), home (home/away), competition (optional)."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty_file")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    try:
        delimiter = csv.Sniffer().sniff(text.splitlines()[0], delimiters=",;\t").delimiter
    except Exception:
        delimiter = ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    alias = {"lawan": "opponent", "tanggal": "date", "jam": "time", "kandang": "home", "kompetisi": "competition", "kickoff_at": "date"}
    now = datetime.now(timezone.utc)
    docs, errors, dup = [], [], 0
    seen = set()
    for i, row in enumerate(reader, start=2):
        n = {alias.get((k or "").strip().lower(), (k or "").strip().lower()): (v or "").strip() for k, v in row.items() if k}
        opp = n.get("opponent", "")
        if not opp or not n.get("date"):
            errors.append(f"Baris {i}: kolom opponent dan date wajib.")
            continue
        ko = _parse_kickoff(n["date"], n.get("time", ""))
        if not ko:
            errors.append(f"Baris {i}: format tanggal/jam salah (contoh 2026-08-20 dan 19:00).")
            continue
        if ko <= now:
            errors.append(f"Baris {i}: jadwal sudah lewat, dilewati.")
            continue
        key = (opp.lower(), ko)
        if key in seen or await db.matches.find_one({"opponent": {"$regex": f"^{re.escape(opp)}$", "$options": "i"}, "kickoff_at": ko}):
            dup += 1
            continue
        seen.add(key)
        h = n.get("home", "home").lower()
        docs.append({
            "match_id": f"mt_{uuid.uuid4().hex[:12]}",
            "opponent": opp[:60],
            "kickoff_at": ko,
            "home": h not in ("away", "tandang", "false", "0", "no", "tidak", "a"),
            "competition": (n.get("competition") or "Liga 1")[:40],
            "final_home": None,
            "final_away": None,
            "created_at": now,
            "created_by": user["user_id"],
            "import_batch": now.isoformat(),
        })
    if docs:
        await db.matches.insert_many(docs)
    if dup:
        errors.append(f"{dup} jadwal sudah ada, dilewati.")
    return {"created": len(docs), "skipped": len(errors) - (1 if dup else 0) + dup, "errors": errors[:20]}


@api_router.post("/admin/matches/{match_id}/result", response_model=MatchOut)
async def matches_set_result(match_id: str, body: MatchResult, user: dict = Depends(require_admin)):
    m = await db.matches.find_one({"match_id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="match_not_found")
    final_home = int(body.final_home)
    final_away = int(body.final_away)
    scorer_ids = list(body.scorer_player_ids or [])
    motm_id = body.motm_player_id
    await db.matches.update_one(
        {"match_id": match_id},
        {"$set": {
            "final_home": final_home,
            "final_away": final_away,
            "scorer_player_ids": scorer_ids,
            "motm_player_id": motm_id,
        }},
    )
    # Score (or re-score, when admin corrects a result) every prediction; notify on first scoring only.
    async for p in db.predictions.find({"match_id": match_id}, {"_id": 0}):
        first_time = p.get("points") is None
        exact = p["pred_home"] == final_home and p["pred_away"] == final_away
        pred_winner = (
            "home" if p["pred_home"] > p["pred_away"] else "away" if p["pred_away"] > p["pred_home"] else "draw"
        )
        actual_winner = (
            "home" if final_home > final_away else "away" if final_away > final_home else "draw"
        )
        points = 300 if exact else (100 if pred_winner == actual_winner else 0)
        scorer_hit = False
        if p.get("scorer_player_id") and p["scorer_player_id"] in scorer_ids:
            points += 150
            scorer_hit = True
        motm_hit = False
        if p.get("motm_player_id") and motm_id and p["motm_player_id"] == motm_id:
            points += 200
            motm_hit = True
        await db.predictions.update_one(
            {"prediction_id": p["prediction_id"]}, {"$set": {"points": points}}
        )
        if not first_time:
            continue
        try:
            parts = []
            if exact:
                parts.append("tepat skor +300")
            elif pred_winner == actual_winner:
                parts.append("tebak pemenang +100")
            if scorer_hit:
                parts.append("pencetak gol +150")
            if motm_hit:
                parts.append("MOTM +200")
            tail = (" · " + " · ".join(parts)) if parts else ""
            msg = f"⚽ Hasil {final_home}-{final_away} vs {m['opponent']} · total +{points} poin{tail}."
            await push_notification(p["user_id"], "prediction", msg)
        except Exception:
            pass
    doc = await db.matches.find_one({"match_id": match_id}, {"_id": 0})
    return _match_to_out(doc)


@api_router.delete("/admin/matches/{match_id}")
async def matches_delete(match_id: str, user: dict = Depends(require_admin)):
    res = await db.matches.update_one(
        {"match_id": match_id}, {"$set": {"deleted_at": datetime.now(timezone.utc)}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="match_not_found")
    return {"ok": True}


@api_router.post("/matches/{match_id}/predict", response_model=PredictionOut)
async def predictions_create(
    match_id: str, body: PredictionIn, user: dict = Depends(get_current_user)
):
    m = await db.matches.find_one({"match_id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="match_not_found")
    if _match_status(m) != "upcoming":
        raise HTTPException(status_code=400, detail="predictions_closed")

    scorer_name = None
    motm_name = None
    if body.scorer_player_id:
        pl = await db.players.find_one({"player_id": body.scorer_player_id}, {"_id": 0})
        scorer_name = pl["name"] if pl else None
    if body.motm_player_id:
        pl = await db.players.find_one({"player_id": body.motm_player_id}, {"_id": 0})
        motm_name = pl["name"] if pl else None

    doc = {
        "prediction_id": f"pr_{uuid.uuid4().hex[:12]}",
        "match_id": match_id,
        "user_id": user["user_id"],
        "name": user["name"],
        "picture": user.get("picture"),
        "pred_home": int(body.pred_home),
        "pred_away": int(body.pred_away),
        "scorer_player_id": body.scorer_player_id,
        "scorer_name": scorer_name,
        "motm_player_id": body.motm_player_id,
        "motm_name": motm_name,
        "created_at": datetime.now(timezone.utc),
    }
    await db.predictions.update_one(
        {"user_id": user["user_id"], "match_id": match_id},
        {"$set": doc},
        upsert=True,
    )
    saved = await db.predictions.find_one(
        {"user_id": user["user_id"], "match_id": match_id}, {"_id": 0}
    )
    return PredictionOut(**saved)


@api_router.get("/matches/{match_id}/predictions", response_model=List[PredictionOut])
async def predictions_for_match(match_id: str, limit: int = 100):
    cursor = db.predictions.find({"match_id": match_id}, {"_id": 0}).limit(limit)
    results: List[PredictionOut] = []
    async for p in cursor:
        results.append(PredictionOut(**p))
    return results


@api_router.get("/me/prediction/{match_id}")
async def my_prediction(match_id: str, user: dict = Depends(get_current_user)):
    doc = await db.predictions.find_one(
        {"user_id": user["user_id"], "match_id": match_id}, {"_id": 0}
    )
    if not doc:
        return {"prediction": None}
    return {"prediction": PredictionOut(**doc)}


@api_router.get("/predictions/leaderboard")
async def predictions_leaderboard(limit: int = 50):
    pipeline = [
        {"$match": {"points": {"$exists": True}}},
        {
            "$group": {
                "_id": "$user_id",
                "name": {"$last": "$name"},
                "picture": {"$last": "$picture"},
                "total_points": {"$sum": "$points"},
                "predictions_count": {"$sum": 1},
            }
        },
        {"$sort": {"total_points": -1}},
        {"$limit": int(limit)},
    ]
    results = []
    async for row in db.predictions.aggregate(pipeline):
        results.append(
            {
                "user_id": row["_id"],
                "name": row.get("name"),
                "picture": row.get("picture"),
                "total_points": int(row.get("total_points", 0)),
                "predictions_count": int(row.get("predictions_count", 0)),
            }
        )
    return results


@api_router.get("/live-match")
async def live_match():
    """Returns the currently-live Madura United match, if any."""
    cursor = db.matches.find({"deleted_at": {"$exists": False}, "final_home": None}, {"_id": 0}).sort(
        "kickoff_at", -1
    )
    async for m in cursor:
        if _match_status(m) == "live":
            kickoff = m["kickoff_at"]
            if isinstance(kickoff, datetime) and kickoff.tzinfo is None:
                kickoff = kickoff.replace(tzinfo=timezone.utc)
            minute = int((datetime.now(timezone.utc) - kickoff).total_seconds() / 60)
            return {
                "live": True,
                "match": _match_to_out(m).model_dump(),
                "minute": max(1, minute),
                "multiplier": 2,
            }
    return {"live": False}


@api_router.get("/challenges/{challenge_id}", response_model=ChallengeOut)
async def challenges_get(challenge_id: str):
    doc = await db.challenges.find_one({"challenge_id": challenge_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="challenge_not_found")
    return ChallengeOut(**{k: v for k, v in doc.items() if k in ChallengeOut.model_fields})


@api_router.post("/challenges/{challenge_id}/complete")
async def challenges_complete(
    challenge_id: str, body: ChallengeComplete, user: dict = Depends(get_current_user)
):
    doc = await db.challenges.find_one({"challenge_id": challenge_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="challenge_not_found")
    beat = int(body.score) > int(doc["score_to_beat"])
    if beat and doc["from_user_id"] != user["user_id"]:
        try:
            await push_notification(
                doc["from_user_id"],
                "challenge",
                f"{user['name']} mengalahkan tantanganmu! Skor {body.score} > {doc['score_to_beat']}.",
                from_user=user,
            )
        except Exception:
            pass
    return {"ok": True, "beat": beat, "score_to_beat": doc["score_to_beat"]}


# ---------- App settings (background + socials + description) ----------
class SocialLinks(BaseModel):
    instagram: Optional[str] = None
    tiktok: Optional[str] = None
    whatsapp: Optional[str] = None
    youtube: Optional[str] = None


class AppSettingsOut(BaseModel):
    background_url: Optional[str] = None
    description: Optional[str] = None
    socials: SocialLinks = Field(default_factory=SocialLinks)
    tournament_enabled: bool = False
    category_logos: dict = Field(default_factory=dict)
    mascot_url: Optional[str] = None


class AppSettingsIn(BaseModel):
    description: Optional[str] = None
    socials: Optional[SocialLinks] = None


async def _load_app_settings() -> dict:
    doc = await db.app_settings.find_one({"_key": "public"}, {"_id": 0})
    return doc or {}


def _settings_to_out(doc: dict) -> AppSettingsOut:
    socials = doc.get("socials") or {}
    return AppSettingsOut(
        background_url=doc.get("background_url"),
        description=doc.get("description"),
        socials=SocialLinks(**socials),
        tournament_enabled=bool(doc.get("tournament_enabled", False)),
        category_logos={k: v for k, v in (doc.get("category_logos") or {}).items() if v},
        mascot_url=doc.get("mascot_url"),
    )


@api_router.get("/app-settings", response_model=AppSettingsOut)
async def get_app_settings():
    return _settings_to_out(await _load_app_settings())


@api_router.put("/admin/app-settings", response_model=AppSettingsOut)
async def set_app_settings(body: AppSettingsIn, user: dict = Depends(require_admin)):
    update: dict = {}
    if body.description is not None:
        update["description"] = body.description.strip()
    if body.socials is not None:
        update["socials"] = {
            "instagram": (body.socials.instagram or "").strip() or None,
            "tiktok": (body.socials.tiktok or "").strip() or None,
            "whatsapp": (body.socials.whatsapp or "").strip() or None,
            "youtube": (body.socials.youtube or "").strip() or None,
        }
    if update:
        update["updated_at"] = datetime.now(timezone.utc)
        update["updated_by"] = user["user_id"]
        await db.app_settings.update_one(
            {"_key": "public"},
            {"$set": {"_key": "public", **update}},
            upsert=True,
        )
    return _settings_to_out(await _load_app_settings())


@api_router.post("/admin/app-settings/background", response_model=AppSettingsOut)
async def upload_background(
    image: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty_image")
    ext = (image.filename or "bg.jpg").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{user['user_id']}/bg_{uuid.uuid4().hex[:8]}.{ext}"
    try:
        await run_in_threadpool(put_object, path, content, image.content_type or f"image/{ext}")
    except Exception as e:
        logger.exception("bg upload failed: %s", e)
        raise HTTPException(status_code=500, detail="bg_upload_failed")
    url = f"/api/files/{path}"
    await db.app_settings.update_one(
        {"_key": "public"},
        {"$set": {"_key": "public", "background_url": url, "updated_at": datetime.now(timezone.utc), "updated_by": user["user_id"]}},
        upsert=True,
    )
    return _settings_to_out(await _load_app_settings())


LOGO_CATEGORIES = {"all", "trivia", "garuda", "liga", "bali", "persebaya", "persib", "persija"}


@api_router.post("/admin/category-logo/{category}", response_model=AppSettingsOut)
async def upload_category_logo(
    category: str,
    image: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    if category not in LOGO_CATEGORIES:
        raise HTTPException(status_code=422, detail="invalid_category")
    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty_image")
    ext = (image.filename or "logo.png").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
        ext = "png"
    path = f"{APP_NAME}/uploads/{user['user_id']}/catlogo_{category}_{uuid.uuid4().hex[:6]}.{ext}"
    try:
        await run_in_threadpool(put_object, path, content, image.content_type or f"image/{ext}")
    except Exception as e:
        logger.exception("category logo upload failed: %s", e)
        raise HTTPException(status_code=500, detail="logo_upload_failed")
    await db.app_settings.update_one(
        {"_key": "public"},
        {"$set": {"_key": "public", f"category_logos.{category}": f"/api/files/{path}",
                  "updated_at": datetime.now(timezone.utc), "updated_by": user["user_id"]}},
        upsert=True,
    )
    return _settings_to_out(await _load_app_settings())


@api_router.delete("/admin/category-logo/{category}", response_model=AppSettingsOut)
async def delete_category_logo(category: str, user: dict = Depends(require_admin)):
    if category not in LOGO_CATEGORIES:
        raise HTTPException(status_code=422, detail="invalid_category")
    await db.app_settings.update_one(
        {"_key": "public"}, {"$unset": {f"category_logos.{category}": ""}}, upsert=True
    )
    return _settings_to_out(await _load_app_settings())


@api_router.delete("/admin/app-settings/background", response_model=AppSettingsOut)
async def delete_background(user: dict = Depends(require_admin)):
    await db.app_settings.update_one(
        {"_key": "public"},
        {"$set": {"background_url": None, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return _settings_to_out(await _load_app_settings())


@api_router.post("/admin/app-settings/mascot", response_model=AppSettingsOut)
async def upload_mascot(image: UploadFile = File(...), user: dict = Depends(require_admin)):
    url = await _store_image(user, image, "mascot", trim=True)
    if not url:
        raise HTTPException(status_code=400, detail="empty_image")
    await db.app_settings.update_one(
        {"_key": "public"}, {"$set": {"_key": "public", "mascot_url": url, "updated_at": datetime.now(timezone.utc)}}, upsert=True
    )
    return _settings_to_out(await _load_app_settings())


@api_router.delete("/admin/app-settings/mascot", response_model=AppSettingsOut)
async def delete_mascot(user: dict = Depends(require_admin)):
    await db.app_settings.update_one({"_key": "public"}, {"$set": {"mascot_url": None}}, upsert=True)
    return _settings_to_out(await _load_app_settings())


# ---------- News (artikel update Madura United) ----------
class NewsOut(BaseModel):
    news_id: str
    title: str
    excerpt: Optional[str] = None
    body: str
    cover_url: Optional[str] = None
    author_name: Optional[str] = None
    author_picture: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    like_count: int = 0
    comment_count: int = 0
    liked: bool = False


class CommentOut(BaseModel):
    comment_id: str
    news_id: str
    user_id: str
    name: str
    picture: Optional[str] = None
    body: str
    parent_comment_id: Optional[str] = None
    mentions: List[str] = []
    created_at: datetime
    replies: List["CommentOut"] = []


class CommentIn(BaseModel):
    body: str
    parent_comment_id: Optional[str] = None
    mentions: Optional[List[str]] = None


async def _news_counts(news_id: str) -> tuple[int, int]:
    like_count = await db.news_likes.count_documents({"news_id": news_id})
    comment_count = await db.news_comments.count_documents(
        {"news_id": news_id, "deleted_at": {"$exists": False}}
    )
    return like_count, comment_count


async def _news_doc_to_out_async(d: dict, viewer_id: Optional[str] = None) -> NewsOut:
    like_count, comment_count = await _news_counts(d["news_id"])
    liked = False
    if viewer_id:
        liked = (
            await db.news_likes.count_documents(
                {"news_id": d["news_id"], "user_id": viewer_id}
            )
        ) > 0
    return NewsOut(
        news_id=d["news_id"],
        title=d["title"],
        excerpt=d.get("excerpt"),
        body=d["body"],
        cover_url=d.get("cover_url"),
        author_name=d.get("author_name"),
        author_picture=d.get("author_picture"),
        created_at=d["created_at"],
        updated_at=d.get("updated_at"),
        like_count=like_count,
        comment_count=comment_count,
        liked=liked,
    )


def _news_doc_to_out(d: dict) -> NewsOut:
    # Sync helper kept for admin create/update return paths where fresh counts (0) are fine.
    return NewsOut(
        news_id=d["news_id"],
        title=d["title"],
        excerpt=d.get("excerpt"),
        body=d["body"],
        cover_url=d.get("cover_url"),
        author_name=d.get("author_name"),
        author_picture=d.get("author_picture"),
        created_at=d["created_at"],
        updated_at=d.get("updated_at"),
        like_count=0,
        comment_count=0,
        liked=False,
    )


async def _optional_user(authorization: Optional[str]) -> Optional[dict]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        return None
    expires = session.get("expires_at")
    if isinstance(expires, datetime):
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return None
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    return user


@api_router.get("/news", response_model=List[NewsOut])
async def news_list(limit: int = 50, authorization: Optional[str] = Header(default=None)):
    viewer = await _optional_user(authorization)
    viewer_id = viewer["user_id"] if viewer else None
    cursor = (
        db.news.find({"deleted_at": {"$exists": False}}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    )
    results: List[NewsOut] = []
    async for d in cursor:
        results.append(await _news_doc_to_out_async(d, viewer_id))
    return results


@api_router.get("/news/{news_id}", response_model=NewsOut)
async def news_get(news_id: str, authorization: Optional[str] = Header(default=None)):
    doc = await db.news.find_one(
        {"news_id": news_id, "deleted_at": {"$exists": False}}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="news_not_found")
    viewer = await _optional_user(authorization)
    viewer_id = viewer["user_id"] if viewer else None
    return await _news_doc_to_out_async(doc, viewer_id)


def _make_excerpt(body: str, limit: int = 160) -> str:
    body = (body or "").strip().replace("\r\n", "\n")
    one = " ".join(body.split())
    return one[:limit] + ("…" if len(one) > limit else "")


@api_router.post("/admin/news", response_model=NewsOut)
async def news_create(
    title: str = Form(...),
    body: str = Form(...),
    cover: Optional[UploadFile] = File(None),
    user: dict = Depends(require_admin),
):
    title = title.strip()
    body = body.strip()
    if not title or not body:
        raise HTTPException(status_code=422, detail="missing_fields")
    news_id = f"nw_{uuid.uuid4().hex[:12]}"
    cover_url = None
    if cover is not None:
        content = await cover.read()
        if content:
            ext = (cover.filename or "cover.jpg").rsplit(".", 1)[-1].lower()
            if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
                ext = "jpg"
            path = f"{APP_NAME}/uploads/{user['user_id']}/news_{news_id}.{ext}"
            try:
                await run_in_threadpool(put_object, path, content, cover.content_type or f"image/{ext}")
                cover_url = f"/api/files/{path}"
            except Exception as e:
                logger.exception("news cover upload failed: %s", e)
                raise HTTPException(status_code=500, detail="cover_upload_failed")
    now = datetime.now(timezone.utc)
    doc = {
        "news_id": news_id,
        "title": title,
        "body": body,
        "excerpt": _make_excerpt(body),
        "cover_url": cover_url,
        "author_id": user["user_id"],
        "author_name": user.get("name"),
        "author_picture": user.get("picture"),
        "created_at": now,
        "updated_at": now,
    }
    await db.news.insert_one(doc)
    return _news_doc_to_out(doc)


class NewsUpdateIn(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None


@api_router.put("/admin/news/{news_id}", response_model=NewsOut)
async def news_update(news_id: str, body_in: NewsUpdateIn, user: dict = Depends(require_admin)):
    existing = await db.news.find_one({"news_id": news_id, "deleted_at": {"$exists": False}}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="news_not_found")
    update: dict = {}
    if body_in.title is not None:
        update["title"] = body_in.title.strip()
    if body_in.body is not None:
        update["body"] = body_in.body.strip()
        update["excerpt"] = _make_excerpt(body_in.body)
    if update:
        update["updated_at"] = datetime.now(timezone.utc)
        await db.news.update_one({"news_id": news_id}, {"$set": update})
    doc = await db.news.find_one({"news_id": news_id}, {"_id": 0})
    return _news_doc_to_out(doc)


@api_router.delete("/admin/news/{news_id}")
async def news_delete(news_id: str, user: dict = Depends(require_admin)):
    res = await db.news.update_one(
        {"news_id": news_id}, {"$set": {"deleted_at": datetime.now(timezone.utc)}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="news_not_found")
    return {"ok": True}


# ---------- News likes & comments ----------
async def _news_exists(news_id: str) -> dict:
    doc = await db.news.find_one(
        {"news_id": news_id, "deleted_at": {"$exists": False}}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="news_not_found")
    return doc


@api_router.post("/news/{news_id}/like")
async def news_like_toggle(news_id: str, user: dict = Depends(get_current_user)):
    news_doc = await _news_exists(news_id)
    existing = await db.news_likes.find_one(
        {"news_id": news_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if existing:
        await db.news_likes.delete_one(
            {"news_id": news_id, "user_id": user["user_id"]}
        )
        liked = False
    else:
        await db.news_likes.insert_one(
            {
                "news_id": news_id,
                "user_id": user["user_id"],
                "created_at": datetime.now(timezone.utc),
            }
        )
        liked = True
        # Notify author (not self-likes).
        try:
            author_id = news_doc.get("author_id")
            if author_id and author_id != user["user_id"]:
                await push_notification(
                    author_id,
                    "news_like",
                    f"{user['name']} menyukai berita '{news_doc['title'][:40]}'.",
                    from_user=user,
                )
        except Exception:
            pass
    royal = 0
    if liked:
        try:
            royal = await award_royal(user, "like_news", ref=news_id)
        except Exception as e:
            logger.warning("royal like error: %s", e)
    like_count = await db.news_likes.count_documents({"news_id": news_id})
    return {"liked": liked, "like_count": like_count, "royal_awarded": royal}


@api_router.get("/news/{news_id}/comments", response_model=List[CommentOut])
async def news_comments_list(news_id: str, limit: int = 200):
    await _news_exists(news_id)
    cursor = db.news_comments.find(
        {"news_id": news_id, "deleted_at": {"$exists": False}}, {"_id": 0}
    ).sort("created_at", 1)
    docs: List[dict] = []
    async for c in cursor:
        docs.append(c)
    # Build threaded structure: top-level sorted newest-first; replies oldest-first.
    by_id: dict[str, CommentOut] = {}
    tops: List[CommentOut] = []
    for d in docs:
        co = CommentOut(
            comment_id=d["comment_id"],
            news_id=d["news_id"],
            user_id=d["user_id"],
            name=d.get("name", "User"),
            picture=d.get("picture"),
            body=d["body"],
            parent_comment_id=d.get("parent_comment_id"),
            mentions=d.get("mentions", []) or [],
            created_at=d["created_at"],
            replies=[],
        )
        by_id[co.comment_id] = co
    for co in by_id.values():
        parent_id = co.parent_comment_id
        if parent_id and parent_id in by_id:
            by_id[parent_id].replies.append(co)
        else:
            tops.append(co)
    # Sort replies oldest-first inside each thread (already true by insertion),
    # and sort top-level newest-first.
    tops.sort(key=lambda c: c.created_at, reverse=True)
    return tops[:limit]


MENTION_RE = re.compile(r"@([A-Za-z0-9_\u00c0-\uffff.\-]{2,40})")


@api_router.get("/users/search")
async def users_search(q: str, limit: int = 8):
    q = (q or "").strip()
    if not q:
        return []
    # Case-insensitive prefix match on name OR short_code.
    pattern = re.compile(f"^{re.escape(q)}", re.IGNORECASE)
    cursor = db.users.find(
        {"$or": [{"name": pattern}, {"short_code": pattern}]},
        {"_id": 0, "user_id": 1, "name": 1, "picture": 1, "short_code": 1},
    ).limit(max(1, min(limit, 20)))
    out = []
    async for u in cursor:
        out.append(
            {
                "user_id": u["user_id"],
                "name": u.get("name"),
                "picture": u.get("picture"),
                "short_code": u.get("short_code"),
            }
        )
    return out


@api_router.post("/news/{news_id}/comments", response_model=CommentOut)
async def news_comment_create(
    news_id: str, body: CommentIn, user: dict = Depends(get_current_user)
):
    news_doc = await _news_exists(news_id)
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="empty_comment")
    if len(text) > 1000:
        text = text[:1000]

    # Validate the parent exists & is in this thread.
    parent_id = (body.parent_comment_id or "").strip() or None
    if parent_id:
        parent = await db.news_comments.find_one(
            {
                "comment_id": parent_id,
                "news_id": news_id,
                "deleted_at": {"$exists": False},
            },
            {"_id": 0, "parent_comment_id": 1, "user_id": 1},
        )
        if not parent:
            raise HTTPException(status_code=404, detail="parent_not_found")
        # Keep thread depth = 1: a reply to a reply still points at the top-level
        # parent so the UI only has one indentation level.
        if parent.get("parent_comment_id"):
            parent_id = parent["parent_comment_id"]
            # refresh parent record for notification target
            parent = await db.news_comments.find_one(
                {"comment_id": parent_id}, {"_id": 0, "user_id": 1}
            )

    # Resolve mentions: client may send user_ids explicitly OR we parse @handles
    # from the body as a fallback.
    mention_ids: List[str] = []
    if body.mentions:
        for uid in body.mentions:
            uid = (uid or "").strip()
            if uid and uid != user["user_id"] and uid not in mention_ids:
                exists = await db.users.find_one({"user_id": uid}, {"_id": 1})
                if exists:
                    mention_ids.append(uid)
    else:
        for match in MENTION_RE.finditer(text):
            handle = match.group(1)
            u = await db.users.find_one(
                {
                    "$or": [
                        {"name": re.compile(f"^{re.escape(handle)}$", re.IGNORECASE)},
                        {"short_code": re.compile(f"^{re.escape(handle)}$", re.IGNORECASE)},
                    ]
                },
                {"_id": 0, "user_id": 1},
            )
            if u and u["user_id"] != user["user_id"] and u["user_id"] not in mention_ids:
                mention_ids.append(u["user_id"])

    doc = {
        "comment_id": f"cm_{uuid.uuid4().hex[:12]}",
        "news_id": news_id,
        "user_id": user["user_id"],
        "name": user["name"],
        "picture": user.get("picture"),
        "body": text,
        "parent_comment_id": parent_id,
        "mentions": mention_ids,
        "created_at": datetime.now(timezone.utc),
    }
    await db.news_comments.insert_one(doc)

    notified: set = {user["user_id"]}

    # Notify article author.
    try:
        author_id = news_doc.get("author_id")
        if author_id and author_id not in notified:
            await push_notification(
                author_id,
                "news_comment",
                f"{user['name']} berkomentar: '{text[:80]}'",
                from_user=user,
            )
            notified.add(author_id)
    except Exception:
        pass

    # Notify parent comment author on replies.
    if parent_id:
        try:
            parent_doc = await db.news_comments.find_one(
                {"comment_id": parent_id}, {"_id": 0, "user_id": 1}
            )
            if parent_doc:
                reply_target = parent_doc["user_id"]
                if reply_target not in notified:
                    await push_notification(
                        reply_target,
                        "news_reply",
                        f"{user['name']} membalas komentar Anda: '{text[:80]}'",
                        from_user=user,
                    )
                    notified.add(reply_target)
        except Exception:
            pass

    # Notify mentioned users.
    for uid in mention_ids:
        if uid in notified:
            continue
        try:
            await push_notification(
                uid,
                "news_mention",
                f"{user['name']} menyebut Anda di komentar: '{text[:80]}'",
                from_user=user,
            )
            notified.add(uid)
        except Exception:
            pass

    try:
        await award_royal(user, "comment_news", ref=doc["comment_id"])
    except Exception as e:
        logger.warning("royal comment error: %s", e)

    return CommentOut(
        comment_id=doc["comment_id"],
        news_id=doc["news_id"],
        user_id=doc["user_id"],
        name=doc["name"],
        picture=doc.get("picture"),
        body=doc["body"],
        parent_comment_id=doc.get("parent_comment_id"),
        mentions=mention_ids,
        created_at=doc["created_at"],
        replies=[],
    )


@api_router.delete("/news/comments/{comment_id}")
async def news_comment_delete(comment_id: str, user: dict = Depends(get_current_user)):
    c = await db.news_comments.find_one(
        {"comment_id": comment_id, "deleted_at": {"$exists": False}}, {"_id": 0}
    )
    if not c:
        raise HTTPException(status_code=404, detail="comment_not_found")
    if c["user_id"] != user["user_id"] and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="not_your_comment")
    await db.news_comments.update_one(
        {"comment_id": comment_id},
        {"$set": {"deleted_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}


# ---------- Quiz Items (Trivia Klub & Garuda Call) ----------
# trivia = "Madura United" (label renamed in UI; key kept for existing data).
ALLOWED_QUIZ_CATEGORIES = {"trivia", "garuda", "liga", "bali", "persebaya", "persib", "persija"}


class QuizItemOut(BaseModel):
    item_id: str
    category: str
    prompt: str
    image_url: Optional[str] = None
    options: List[str]
    answer_index: int
    active: bool = True
    order_index: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None


class QuizItemUpdateIn(BaseModel):
    prompt: Optional[str] = None
    options: Optional[List[str]] = None
    answer_index: Optional[int] = None
    active: Optional[bool] = None
    order_index: Optional[int] = None


def _quiz_item_to_out(d: dict) -> QuizItemOut:
    return QuizItemOut(
        item_id=d["item_id"],
        category=d["category"],
        prompt=d["prompt"],
        image_url=d.get("image_url"),
        options=d.get("options", []),
        answer_index=int(d.get("answer_index", 0)),
        active=bool(d.get("active", True)),
        order_index=int(d.get("order_index", 0)),
        created_at=d["created_at"],
        updated_at=d.get("updated_at"),
    )


def _assert_category(category: str):
    if category not in ALLOWED_QUIZ_CATEGORIES:
        raise HTTPException(status_code=422, detail="invalid_category")


@api_router.get("/quiz-items", response_model=List[QuizItemOut])
async def quiz_items_public(category: str):
    if category != "all":
        _assert_category(category)
    cat_q = {"$in": list(ALLOWED_QUIZ_CATEGORIES)} if category == "all" else category
    cursor = db.quiz_items.find(
        {
            "category": cat_q,
            "active": True,
            "deleted_at": {"$exists": False},
        },
        {"_id": 0},
    ).sort([("order_index", 1), ("created_at", 1)])
    out: List[QuizItemOut] = []
    async for d in cursor:
        out.append(_quiz_item_to_out(d))
    return out


@api_router.get("/admin/quiz-items", response_model=List[QuizItemOut])
async def quiz_items_admin_list(category: str, user: dict = Depends(require_admin)):
    _assert_category(category)
    cursor = db.quiz_items.find(
        {"category": category, "deleted_at": {"$exists": False}}, {"_id": 0}
    ).sort([("order_index", 1), ("created_at", 1)])
    out: List[QuizItemOut] = []
    async for d in cursor:
        out.append(_quiz_item_to_out(d))
    return out


@api_router.post("/admin/quiz-items", response_model=QuizItemOut)
async def quiz_items_create(
    category: str = Form(...),
    prompt: str = Form(...),
    option_a: str = Form(...),
    option_b: str = Form(...),
    option_c: str = Form(...),
    option_d: str = Form(...),
    answer_index: int = Form(...),
    active: bool = Form(True),
    order_index: int = Form(0),
    image: Optional[UploadFile] = File(None),
    user: dict = Depends(require_admin),
):
    _assert_category(category)
    if answer_index < 0 or answer_index > 3:
        raise HTTPException(status_code=422, detail="invalid_answer_index")
    opts = [option_a.strip(), option_b.strip(), option_c.strip(), option_d.strip()]
    if any(not o for o in opts):
        raise HTTPException(status_code=422, detail="empty_option")
    item_id = f"qi_{uuid.uuid4().hex[:12]}"
    image_url = None
    if image is not None:
        content = await image.read()
        if content:
            ext = (image.filename or "img.jpg").rsplit(".", 1)[-1].lower()
            if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
                ext = "jpg"
            path = f"{APP_NAME}/uploads/{user['user_id']}/quiz_{item_id}.{ext}"
            try:
                await run_in_threadpool(
                    put_object, path, content, image.content_type or f"image/{ext}"
                )
                image_url = f"/api/files/{path}"
            except Exception as e:
                logger.exception("quiz image upload failed: %s", e)
                raise HTTPException(status_code=500, detail="image_upload_failed")
    now = datetime.now(timezone.utc)
    doc = {
        "item_id": item_id,
        "category": category,
        "prompt": prompt.strip(),
        "image_url": image_url,
        "options": opts,
        "answer_index": int(answer_index),
        "active": bool(active),
        "order_index": int(order_index),
        "created_at": now,
        "updated_at": now,
        "created_by": user["user_id"],
    }
    await db.quiz_items.insert_one(doc)
    return _quiz_item_to_out(doc)


@api_router.put("/admin/quiz-items/{item_id}", response_model=QuizItemOut)
async def quiz_items_update(
    item_id: str, body: QuizItemUpdateIn, user: dict = Depends(require_admin)
):
    existing = await db.quiz_items.find_one(
        {"item_id": item_id, "deleted_at": {"$exists": False}}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="item_not_found")
    update: dict = {}
    if body.prompt is not None:
        update["prompt"] = body.prompt.strip()
    if body.options is not None:
        if len(body.options) != 4 or any(not o.strip() for o in body.options):
            raise HTTPException(status_code=422, detail="invalid_options")
        update["options"] = [o.strip() for o in body.options]
    if body.answer_index is not None:
        if body.answer_index < 0 or body.answer_index > 3:
            raise HTTPException(status_code=422, detail="invalid_answer_index")
        update["answer_index"] = int(body.answer_index)
    if body.active is not None:
        update["active"] = bool(body.active)
    if body.order_index is not None:
        update["order_index"] = int(body.order_index)
    if update:
        update["updated_at"] = datetime.now(timezone.utc)
        await db.quiz_items.update_one({"item_id": item_id}, {"$set": update})
    doc = await db.quiz_items.find_one({"item_id": item_id}, {"_id": 0})
    return _quiz_item_to_out(doc)


@api_router.post("/admin/quiz-items/{item_id}/image", response_model=QuizItemOut)
async def quiz_items_set_image(
    item_id: str,
    image: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    existing = await db.quiz_items.find_one(
        {"item_id": item_id, "deleted_at": {"$exists": False}}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="item_not_found")
    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty_image")
    ext = (image.filename or "img.jpg").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{user['user_id']}/quiz_{item_id}_{uuid.uuid4().hex[:6]}.{ext}"
    try:
        await run_in_threadpool(put_object, path, content, image.content_type or f"image/{ext}")
    except Exception as e:
        logger.exception("quiz image upload failed: %s", e)
        raise HTTPException(status_code=500, detail="image_upload_failed")
    url = f"/api/files/{path}"
    await db.quiz_items.update_one(
        {"item_id": item_id},
        {"$set": {"image_url": url, "updated_at": datetime.now(timezone.utc)}},
    )
    doc = await db.quiz_items.find_one({"item_id": item_id}, {"_id": 0})
    return _quiz_item_to_out(doc)


@api_router.delete("/admin/quiz-items/{item_id}")
async def quiz_items_delete(item_id: str, user: dict = Depends(require_admin)):
    res = await db.quiz_items.update_one(
        {"item_id": item_id, "deleted_at": {"$exists": False}},
        {"$set": {"deleted_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="item_not_found")
    return {"ok": True}


class QuizReorderIn(BaseModel):
    category: str
    item_ids: List[str]


@api_router.post("/admin/quiz-items/reorder")
async def quiz_items_reorder(
    body: QuizReorderIn, user: dict = Depends(require_admin)
):
    _assert_category(body.category)
    now = datetime.now(timezone.utc)
    for idx, item_id in enumerate(body.item_ids):
        await db.quiz_items.update_one(
            {
                "item_id": item_id,
                "category": body.category,
                "deleted_at": {"$exists": False},
            },
            {"$set": {"order_index": idx, "updated_at": now}},
        )
    return {"ok": True, "count": len(body.item_ids)}


class QuizImportResult(BaseModel):
    created: int
    skipped: int
    errors: List[str] = []
    items: List[QuizItemOut]


IMAGE_URL_COLUMNS = ("image_url", "image", "gambar", "foto", "url_gambar", "link_gambar", "image_link")


def _direct_image_link(url: str) -> str:
    """Turn common share links (Google Drive, Dropbox) into direct-download links."""
    m = re.search(r"drive\.google\.com/(?:file/d/|open\?id=|uc\?(?:.*&)?id=)([\w-]+)", url)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"
    if "dropbox.com" in url:
        return re.sub(r"([?&])dl=0", r"\1dl=1", url) if "dl=0" in url else url + ("&" if "?" in url else "?") + "dl=1"
    return url


async def _import_image_from_url(user: dict, url: str, item_id: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as c:
            r = await c.get(_direct_image_link(url))
        ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
        if r.status_code != 200 or not ctype.startswith("image/") or not r.content or len(r.content) > 10 * 1024 * 1024:
            return None
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(ctype, "jpg")
        path = f"{APP_NAME}/uploads/{user['user_id']}/qi_{item_id}_{uuid.uuid4().hex[:6]}.{ext}"
        await run_in_threadpool(put_object, path, r.content, ctype)
        return f"/api/files/{path}"
    except Exception as e:
        logger.warning("csv image fetch failed %s: %s", url, e)
        return None


@api_router.post("/admin/quiz-items/import", response_model=QuizImportResult)
async def quiz_items_import(
    category: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    _assert_category(category)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty_file")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=400, detail="invalid_encoding")

    # Allow comma or semicolon delimited CSV.
    try:
        sniffed = csv.Sniffer().sniff(text.splitlines()[0] if text else "", delimiters=",;\t")
        delimiter = sniffed.delimiter
    except Exception:
        delimiter = ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    required = {"prompt", "option_a", "option_b", "option_c", "option_d", "answer_index"}
    if not reader.fieldnames or not required.issubset({c.strip().lower() for c in reader.fieldnames}):
        raise HTTPException(
            status_code=422,
            detail=f"missing_columns:{','.join(sorted(required))}",
        )

    now = datetime.now(timezone.utc)
    created: List[dict] = []
    errors: List[str] = []
    skipped = 0

    # New rows go to the top of the admin list (0..n-1); existing items shift down after insert.
    next_order = 0

    for i, row in enumerate(reader, start=2):  # start=2 to account for header row
        norm = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if k}
        prompt = norm.get("prompt", "")
        a = norm.get("option_a", "")
        b = norm.get("option_b", "")
        c = norm.get("option_c", "")
        d = norm.get("option_d", "")
        ans = norm.get("answer_index", "")
        active_raw = norm.get("active", "true").lower()
        image_url = next((norm[k] for k in IMAGE_URL_COLUMNS if norm.get(k)), None)
        if not prompt or not a or not b or not c or not d:
            skipped += 1
            errors.append(f"Baris {i}: kolom wajib kosong.")
            continue
        try:
            ans_i = int(ans)
            if ans_i < 0 or ans_i > 3:
                raise ValueError()
        except ValueError:
            skipped += 1
            errors.append(f"Baris {i}: answer_index harus 0-3 (dapat '{ans}').")
            continue
        active = active_raw not in ("0", "false", "no", "off", "")
        doc = {
            "item_id": f"qi_{uuid.uuid4().hex[:12]}",
            "category": category,
            "prompt": prompt,
            "image_url": image_url if (image_url and image_url.startswith(("http://", "https://", "/api/"))) else None,
            "options": [a, b, c, d],
            "answer_index": ans_i,
            "active": active,
            "order_index": next_order,
            "created_at": now,
            "updated_at": now,
            "created_by": user["user_id"],
            "import_batch": now.isoformat(),
            "_row": i,
        }
        created.append(doc)
        next_order += 1

    if created:
        # Copy every linked image into our storage so it shows in the question's image slot
        # (works for Google Drive / Dropbox share links and sites that block hotlinking).
        sem = asyncio.Semaphore(6)

        async def _fetch(doc: dict, row_no: int):
            src = doc.get("image_url")
            if not src or src.startswith("/api/"):
                return
            async with sem:
                stored = await _import_image_from_url(user, src, doc["item_id"])
            if stored:
                doc["image_url"] = stored
            elif _direct_image_link(src) != src:
                # Share-page links never render as images, so drop them and tell the admin.
                doc["image_url"] = None
                errors.append(f"Baris {row_no}: gambar dari link tidak bisa diunduh (pastikan link dibagikan publik).")
            # Otherwise keep the original direct link; the app can still load it.

        await asyncio.gather(*[_fetch(d, d.pop("_row")) for d in created])
        await db.quiz_items.update_many(
            {"category": category, "deleted_at": {"$exists": False}}, {"$inc": {"order_index": len(created)}}
        )
        await db.quiz_items.insert_many(created)
    return QuizImportResult(
        created=len(created),
        skipped=skipped,
        errors=errors[:20],
        items=[_quiz_item_to_out(d) for d in created],
    )


# ---------- Tournament (Classic / Time Attack / Royal) ----------
WIB = timezone(timedelta(hours=7))
TOURNAMENT_BOARDS = {"classic", "time_attack", "royal"}
T_CLASSIC_COUNT = 20
T_CLASSIC_MAX_PER_Q = 200  # 100 base + up to 100 speed bonus
T_TA_POINT = 100

ROYAL_MISSIONS: dict = {
    "like_news": {"title": "Like Berita", "desc": "Sukai berita Madura United", "points": 5, "daily_limit": 5, "icon": "heart"},
    "comment_news": {"title": "Komentar Berita", "desc": "Tulis komentar di berita", "points": 10, "daily_limit": 3, "icon": "chatbubble-ellipses"},
    "play_classic": {"title": "Main Tournament Classic", "desc": "Selesaikan 20 soal Classic", "points": 10, "daily_limit": 3, "icon": "trophy"},
    "play_time_attack": {"title": "Main Tournament Time Attack", "desc": "Selesaikan 1 ronde 90 detik", "points": 5, "daily_limit": 3, "icon": "timer"},
    "submit_video": {"title": "Kirim Link Video", "desc": "Video dukungan untuk MU (disetujui admin)", "points": 20, "daily_limit": 1, "icon": "videocam"},
}


def _day_key(dt: Optional[datetime] = None) -> str:
    return (dt or datetime.now(timezone.utc)).astimezone(WIB).strftime("%Y-%m-%d")


async def _tournament_enabled() -> bool:
    doc = await _load_app_settings()
    return bool(doc.get("tournament_enabled", False))


async def _board_add(board: str, user: dict, *, inc: Optional[int] = None, best: Optional[int] = None,
                     correct: int = 0, total: int = 0) -> int:
    """Update a tournament board row. `inc` = cumulative add, `best` = keep highest. Returns new board score."""
    now = datetime.now(timezone.utc)
    base_set = {"board": board, "user_id": user["user_id"], "name": user["name"],
                "picture": user.get("picture"), "updated_at": now}
    if inc is not None:
        doc = await db.tournament_boards.find_one_and_update(
            {"board": board, "user_id": user["user_id"]},
            {"$set": base_set, "$inc": {"score": int(inc), "games": 1 if board != "royal" else 0,
                                         "correct": correct, "total": total}},
            upsert=True, return_document=True, projection={"_id": 0},
        )
        return int(doc.get("score", 0))
    existing = await db.tournament_boards.find_one({"board": board, "user_id": user["user_id"]}, {"_id": 0})
    if existing is None or int(existing.get("score", 0)) < int(best or 0):
        await db.tournament_boards.update_one(
            {"board": board, "user_id": user["user_id"]},
            {"$set": {**base_set, "score": int(best or 0), "correct": correct, "total": total},
             "$inc": {"games": 1}},
            upsert=True,
        )
        return int(best or 0)
    await db.tournament_boards.update_one(
        {"board": board, "user_id": user["user_id"]}, {"$set": base_set, "$inc": {"games": 1}}
    )
    return int(existing.get("score", 0))


async def _board_rank(board: str, user_id: str) -> Optional[int]:
    row = await db.tournament_boards.find_one({"board": board, "user_id": user_id}, {"_id": 0, "score": 1})
    if not row:
        return None
    higher = await db.tournament_boards.count_documents({"board": board, "score": {"$gt": int(row.get("score", 0))}})
    return higher + 1


async def award_royal(user: dict, mission: str, ref: Optional[str] = None,
                      day_key: Optional[str] = None, force: bool = False) -> int:
    """Grant Royal points for a mission respecting daily limits. Returns points awarded (0 if none)."""
    cfg = ROYAL_MISSIONS.get(mission)
    if not cfg:
        return 0
    if not force and not await _tournament_enabled():
        return 0
    dk = day_key or _day_key()
    if ref and await db.royal_events.find_one({"user_id": user["user_id"], "mission": mission, "ref": ref}):
        return 0
    done = await db.royal_events.count_documents({"user_id": user["user_id"], "mission": mission, "day_key": dk})
    if done >= cfg["daily_limit"] and not force:
        return 0
    pts = int(cfg["points"])
    await db.royal_events.insert_one({
        "event_id": f"re_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], "mission": mission,
        "ref": ref, "day_key": dk, "points": pts, "created_at": datetime.now(timezone.utc),
    })
    await db.users.update_one({"user_id": user["user_id"]}, {"$inc": {"royal_points": pts}})
    await _board_add("royal", user, inc=pts)
    return pts


async def _submit_tournament_score(body: "ScoreSubmit", user: dict) -> dict:
    if not await _tournament_enabled():
        raise HTTPException(status_code=403, detail="tournament_closed")
    correct = max(0, int(body.correct))
    total = max(correct, int(body.total))
    score = max(0, int(body.score))
    if body.mode == "t_classic":
        total = min(total, T_CLASSIC_COUNT)
        correct = min(correct, total)
        score = min(score, correct * T_CLASSIC_MAX_PER_Q)
        board = "classic"
        board_score = await _board_add(board, user, inc=score, correct=correct, total=total)
        royal = await award_royal(user, "play_classic")
        new_best = False
    else:
        correct = min(correct, 200)
        score = min(score, correct * T_TA_POINT)
        board = "time_attack"
        prev = await db.tournament_boards.find_one({"board": board, "user_id": user["user_id"]}, {"_id": 0, "score": 1})
        board_score = await _board_add(board, user, best=score, correct=correct, total=total)
        new_best = prev is None or score > int(prev.get("score", 0))
        royal = await award_royal(user, "play_time_attack")
    await db.scores.insert_one({
        "entry_id": f"sc_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], "name": user["name"],
        "picture": user.get("picture"), "score": score, "base_score": score, "streak_bonus": 0,
        "mode": body.mode, "category": "tournament", "correct": correct, "total": total,
        "week_key": _week_key(datetime.now(timezone.utc)), "created_at": datetime.now(timezone.utc),
    })
    return {
        "ok": True, "score": score, "streak": int(user.get("current_streak", 0) or 0), "streak_bonus": 0,
        "board": board, "board_score": board_score, "new_best": new_best,
        "rank": await _board_rank(board, user["user_id"]), "royal_awarded": royal,
    }


class TournamentToggleIn(BaseModel):
    enabled: Optional[bool] = None
    categories: Optional[List[str]] = None  # quiz categories mixed into Tournament questions


class TournamentEntry(BaseModel):
    user_id: str
    name: str
    picture: Optional[str] = None
    score: int
    games: int = 0
    correct: int = 0
    total: int = 0


class VideoSubmitIn(BaseModel):
    url: str
    caption: Optional[str] = None


class VideoOut(BaseModel):
    video_id: str
    user_id: str
    name: str
    picture: Optional[str] = None
    url: str
    caption: Optional[str] = None
    status: Literal["pending", "approved", "rejected"]
    created_at: datetime
    reviewed_at: Optional[datetime] = None


class VideoReviewIn(BaseModel):
    approve: bool


async def _tournament_categories() -> List[str]:
    doc = await _load_app_settings()
    cats = doc.get("tournament_categories")
    return [c for c in cats if c in ALLOWED_QUIZ_CATEGORIES] if isinstance(cats, list) else sorted(ALLOWED_QUIZ_CATEGORIES)


@api_router.get("/tournament/status")
async def tournament_status():
    return {"enabled": await _tournament_enabled(), "categories": await _tournament_categories()}


@api_router.post("/admin/tournament/reset")
async def tournament_reset(user: dict = Depends(require_admin)):
    """One-off event: archive then wipe every Tournament board (Classic, Time Attack, Royal)."""
    now = datetime.now(timezone.utc)
    rows = await db.tournament_boards.find({}, {"_id": 0}).to_list(100000)
    if rows:
        await db.tournament_archives.insert_one({"archive_id": f"ta_{uuid.uuid4().hex[:10]}", "reset_at": now,
                                                 "reset_by": user["user_id"], "rows": rows})
    for r in rows:
        if r.get("board") in ("classic", "time_attack") and int(r.get("score", 0) or 0) > 0:
            await db.users.update_one({"user_id": r["user_id"]}, {"$inc": {"xp_banked": int(r["score"])}})
    await db.tournament_boards.delete_many({})
    await db.users.update_many({"royal_points": {"$gt": 0}}, {"$set": {"royal_points": 0}})
    return {"ok": True, "cleared": len(rows)}


@api_router.put("/admin/tournament")
async def tournament_toggle(body: TournamentToggleIn, user: dict = Depends(require_admin)):
    upd: dict = {"_key": "public", "updated_at": datetime.now(timezone.utc), "updated_by": user["user_id"]}
    if body.enabled is not None:
        upd["tournament_enabled"] = bool(body.enabled)
    if body.categories is not None:
        cats = [c for c in body.categories if c in ALLOWED_QUIZ_CATEGORIES]
        if not cats:
            raise HTTPException(status_code=422, detail="need_one_category")
        upd["tournament_categories"] = cats
    await db.app_settings.update_one({"_key": "public"}, {"$set": upd}, upsert=True)
    return {"enabled": await _tournament_enabled(), "categories": await _tournament_categories()}


@api_router.get("/tournament/leaderboard", response_model=List[TournamentEntry])
async def tournament_leaderboard(board: str = "classic", limit: int = 50):
    if board not in TOURNAMENT_BOARDS:
        raise HTTPException(status_code=422, detail="invalid_board")
    cursor = db.tournament_boards.find({"board": board, "score": {"$gt": 0}}, {"_id": 0}).sort(
        [("score", -1), ("updated_at", 1)]).limit(max(1, min(limit, 200)))
    return [TournamentEntry(**{k: d.get(k) for k in TournamentEntry.model_fields if d.get(k) is not None})
            async for d in cursor]


def _video_out(d: dict) -> VideoOut:
    return VideoOut(**{k: d.get(k) for k in VideoOut.model_fields})


@api_router.get("/tournament/me")
async def tournament_me(user: dict = Depends(get_current_user)):
    dk = _day_key()
    counts: dict = {}
    async for ev in db.royal_events.find({"user_id": user["user_id"], "day_key": dk}, {"_id": 0, "mission": 1}):
        counts[ev["mission"]] = counts.get(ev["mission"], 0) + 1
    missions = [
        {"key": k, **cfg, "done_today": min(counts.get(k, 0), cfg["daily_limit"])}
        for k, cfg in ROYAL_MISSIONS.items()
    ]
    boards: dict = {}
    for b in TOURNAMENT_BOARDS:
        row = await db.tournament_boards.find_one({"board": b, "user_id": user["user_id"]}, {"_id": 0})
        boards[b] = {
            "score": int((row or {}).get("score", 0)),
            "games": int((row or {}).get("games", 0)),
            "rank": await _board_rank(b, user["user_id"]) if row else None,
        }
    videos = [
        _video_out(d) async for d in db.royal_videos.find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1).limit(20)
    ]
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "royal_points": 1})
    return {
        "enabled": await _tournament_enabled(),
        "royal_points": int((fresh or {}).get("royal_points", 0) or 0),
        "missions": missions,
        "boards": boards,
        "videos": videos,
    }


@api_router.post("/royal/videos", response_model=VideoOut)
async def royal_video_submit(body: VideoSubmitIn, user: dict = Depends(get_current_user)):
    if not await _tournament_enabled():
        raise HTTPException(status_code=403, detail="tournament_closed")
    url = (body.url or "").strip()
    if not re.match(r"^https?://[^\s]+\.[^\s]+", url) or len(url) > 500:
        raise HTTPException(status_code=422, detail="invalid_url")
    dk = _day_key()
    today = await db.royal_videos.count_documents(
        {"user_id": user["user_id"], "day_key": dk, "status": {"$in": ["pending", "approved"]}})
    if today >= ROYAL_MISSIONS["submit_video"]["daily_limit"]:
        raise HTTPException(status_code=429, detail="daily_limit_reached")
    doc = {
        "video_id": f"rv_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], "name": user["name"],
        "picture": user.get("picture"), "url": url, "caption": (body.caption or "").strip()[:200] or None,
        "status": "pending", "day_key": dk, "created_at": datetime.now(timezone.utc), "reviewed_at": None,
    }
    await db.royal_videos.insert_one(doc)
    return _video_out(doc)


@api_router.get("/admin/royal/videos", response_model=List[VideoOut])
async def royal_videos_admin(status: str = "pending", user: dict = Depends(require_admin)):
    q = {} if status == "all" else {"status": status}
    return [_video_out(d) async for d in db.royal_videos.find(q, {"_id": 0}).sort("created_at", -1).limit(100)]


@api_router.post("/admin/royal/videos/{video_id}/review", response_model=VideoOut)
async def royal_video_review(video_id: str, body: VideoReviewIn, user: dict = Depends(require_admin)):
    v = await db.royal_videos.find_one({"video_id": video_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="not_found")
    if v["status"] != "pending":
        raise HTTPException(status_code=409, detail="already_reviewed")
    status = "approved" if body.approve else "rejected"
    now = datetime.now(timezone.utc)
    await db.royal_videos.update_one({"video_id": video_id},
                                     {"$set": {"status": status, "reviewed_at": now, "reviewed_by": user["user_id"]}})
    owner = await db.users.find_one({"user_id": v["user_id"]}, {"_id": 0})
    if owner:
        if body.approve:
            pts = await award_royal(owner, "submit_video", ref=video_id, day_key=v.get("day_key"), force=True)
            msg = f"Video kamu disetujui admin! +{pts} poin Royal 👑"
        else:
            msg = "Video kamu belum disetujui admin. Coba kirim video lain ya."
        try:
            await push_notification(owner["user_id"], "royal_video", msg, from_user=user)
        except Exception:
            pass
    v.update({"status": status, "reviewed_at": now})
    return _video_out(v)



app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _migrate_players_to_trivia():
    """One-time: turn every 'Tebak Pemain' player photo into a Madura United (trivia) picture question."""
    flag = await db.app_settings.find_one({"_key": "migrations"}, {"_id": 0})
    if flag and flag.get("players_to_trivia_v1"):
        return
    players = await db.players.find({"deleted_at": {"$exists": False}}, {"_id": 0}).to_list(2000)
    names = list({p["name"] for p in players if p.get("name")})
    fallback = ["Beto Goncalves", "Greg Nwokolo", "Zah Rahan", "Bayu Gatra", "Fachruddin Aryanto", "Slamet Nurcahyo"]
    last = await db.quiz_items.find({"category": "trivia"}, {"_id": 0, "order_index": 1}).sort("order_index", -1).limit(1).to_list(1)
    order = int(last[0]["order_index"]) + 1 if last else 0
    n = 0
    for p in players:
        if not p.get("photo_url") or p.get("included_in_quiz") is False:
            continue
        if await db.quiz_items.find_one({"source_player_id": p["player_id"]}):
            continue
        pool = [x for x in names + fallback if x != p["name"]]
        random.shuffle(pool)
        distractors = list(dict.fromkeys(pool))[:3]
        opts = distractors + [p["name"]]
        random.shuffle(opts)
        now = datetime.now(timezone.utc)
        await db.quiz_items.insert_one({
            "item_id": f"qi_{uuid.uuid4().hex[:12]}", "category": "trivia",
            "prompt": "Siapa pemain Madura United ini?", "image_url": p["photo_url"],
            "options": opts, "answer_index": opts.index(p["name"]), "active": True,
            "order_index": order, "created_at": now, "updated_at": now,
            "created_by": "migration", "source_player_id": p["player_id"],
        })
        order += 1
        n += 1
    await db.app_settings.update_one(
        {"_key": "migrations"},
        {"$set": {"_key": "migrations", "players_to_trivia_v1": True}},
        upsert=True,
    )
    logger.info("players->trivia migration: %d questions", n)


async def _migrate_classic_cumulative():
    """One-time: rebuild Classic leaderboard rows as the SUM of all past Classic sessions."""
    flag = await db.app_settings.find_one({"_key": "migrations"}, {"_id": 0})
    if flag and flag.get("classic_cumulative_v1"):
        return
    pipeline = [
        {"$match": {"mode": "classic"}},
        {"$sort": {"created_at": 1}},
        {"$group": {
            "_id": "$user_id", "name": {"$last": "$name"}, "picture": {"$last": "$picture"},
            "category": {"$last": "$category"}, "score": {"$sum": "$score"},
            "correct": {"$sum": "$correct"}, "total": {"$sum": "$total"},
            "games": {"$sum": 1}, "created_at": {"$last": "$created_at"},
        }},
    ]
    n = 0
    async for r in db.scores.aggregate(pipeline):
        uid = r.pop("_id")
        await db.best_scores.update_one(
            {"user_id": uid, "mode": "classic"},
            {"$set": {**r, "user_id": uid, "mode": "classic"}},
            upsert=True,
        )
        n += 1
    await db.app_settings.update_one(
        {"_key": "migrations"},
        {"$set": {"_key": "migrations", "classic_cumulative_v1": True, "at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    logger.info("classic cumulative migration: %d users", n)


@app.on_event("startup")
async def startup_indexes():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.users.create_index("username", unique=True, sparse=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.best_scores.create_index([("mode", 1), ("score", -1)])
        await db.best_scores.create_index([("user_id", 1), ("mode", 1)], unique=True)
        await db.friendships.create_index(
            [("follower_id", 1), ("following_id", 1)], unique=True
        )
        await db.friendships.create_index("follower_id")
        await db.players.create_index("player_id", unique=True)
        await db.players.create_index("included_in_quiz")
        await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
        await db.notifications.create_index([("user_id", 1), ("read", 1)])
        await db.scores.create_index([("mode", 1), ("week_key", 1), ("score", -1)])
        await db.badges.create_index([("user_id", 1), ("created_at", -1)])
        await db.badges.create_index(
            [("user_id", 1), ("week_key", 1), ("mode", 1), ("rank", 1)], unique=True
        )
        await db.challenges.create_index("challenge_id", unique=True)
        await db.challenges.create_index([("from_user_id", 1), ("created_at", -1)])
        await db.users.create_index([("current_streak", -1)])
        await db.matches.create_index("match_id", unique=True)
        await db.matches.create_index([("kickoff_at", -1)])
        await db.predictions.create_index([("user_id", 1), ("match_id", 1)], unique=True)
        await db.predictions.create_index("match_id")
        await db.news.create_index("news_id", unique=True)
        await db.news.create_index([("created_at", -1)])
        await db.news_likes.create_index([("news_id", 1), ("user_id", 1)], unique=True)
        await db.news_comments.create_index([("news_id", 1), ("created_at", -1)])
        await db.news_comments.create_index("comment_id", unique=True)
        await db.quiz_items.create_index("item_id", unique=True)
        await db.quiz_items.create_index([("category", 1), ("active", 1), ("order_index", 1)])
        await db.game_sessions.create_index("game_id", unique=True)
        await db.user_cards.create_index([("user_id", 1), ("card_id", 1)], unique=True)
        await db.store_cards.create_index("card_id", unique=True)
        await db.f100_items.create_index("item_id", unique=True)
        await db.f100_sessions.create_index("game_id", unique=True)
        await db.f100_sessions.create_index("started_at", expireAfterSeconds=86400)
        await db.f100_board.create_index("user_id", unique=True)
        await db.f100_board.create_index([("score", -1)])
        await db.game_sessions.create_index("started_at", expireAfterSeconds=86400)
        await db.tournament_boards.create_index([("board", 1), ("user_id", 1)], unique=True)
        await db.tournament_boards.create_index([("board", 1), ("score", -1)])
        await db.royal_events.create_index([("user_id", 1), ("mission", 1), ("day_key", 1)])
        await db.royal_videos.create_index("video_id", unique=True)
        await db.royal_videos.create_index([("status", 1), ("created_at", -1)])
    except Exception as e:
        logger.warning("index creation issue: %s", e)

    try:
        await _migrate_classic_cumulative()
    except Exception as e:
        logger.warning("classic cumulative migration issue: %s", e)
    try:
        await _migrate_players_to_trivia()
    except Exception as e:
        logger.warning("players->trivia migration issue: %s", e)

    try:
        await run_in_threadpool(init_storage)
    except Exception as e:
        logger.warning("storage init issue: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
