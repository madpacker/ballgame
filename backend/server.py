from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends, UploadFile, File, Form, Query
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import secrets
import string
import httpx
import requests
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


class ScoreSubmit(BaseModel):
    score: int
    mode: Literal["classic", "time_attack"]
    category: str
    correct: int
    total: int


class LeaderboardEntry(BaseModel):
    user_id: str
    name: str
    picture: Optional[str] = None
    score: int
    mode: str
    category: str
    correct: int
    total: int
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
        await db.users.update_one(
            {"user_id": user_id}, {"$set": {"name": name, "picture": picture}}
        )
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
@api_router.post("/scores")
async def submit_score(body: ScoreSubmit, user: dict = Depends(get_current_user)):
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
    return {"ok": True, "score": doc["score"], "streak": current, "streak_bonus": streak_bonus, "streak_milestone": streak_milestone}


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
        results.append(LeaderboardEntry(**doc))
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
            cursor = (
                db.scores.find({"mode": mode, "week_key": last_key}, {"_id": 0})
                .sort("score", -1)
            )
            seen = set()
            rank = 0
            async for s in cursor:
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
    cursor = db.scores.find({"mode": mode, "week_key": cur_key}, {"_id": 0}).sort("score", -1)
    best_per_user: dict[str, dict] = {}
    async for s in cursor:
        uid = s["user_id"]
        if uid not in best_per_user:
            best_per_user[uid] = s
    results = [LeaderboardEntry(**v) for v in list(best_per_user.values())[:limit]]
    return results


class BadgeOut(BaseModel):
    badge_id: str
    week_key: str
    mode: str
    rank: int
    score: int
    created_at: datetime


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
    except Exception as e:
        logger.warning("index creation issue: %s", e)

    try:
        await run_in_threadpool(init_storage)
    except Exception as e:
        logger.warning("storage init issue: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
