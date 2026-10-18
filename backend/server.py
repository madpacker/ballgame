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
    return {"ok": True, "score": doc["score"], "streak": current, "streak_bonus": streak_bonus, "streak_milestone": streak_milestone, "live_bonus": live_bonus}


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
    final_home: int
    final_away: int
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
    # Score each prediction and notify.
    async for p in db.predictions.find({"match_id": match_id, "points": {"$exists": False}}, {"_id": 0}):
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


@api_router.delete("/admin/app-settings/background", response_model=AppSettingsOut)
async def delete_background(user: dict = Depends(require_admin)):
    await db.app_settings.update_one(
        {"_key": "public"},
        {"$set": {"background_url": None, "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
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
    created_at: datetime


class CommentIn(BaseModel):
    body: str


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
    like_count = await db.news_likes.count_documents({"news_id": news_id})
    return {"liked": liked, "like_count": like_count}


@api_router.get("/news/{news_id}/comments", response_model=List[CommentOut])
async def news_comments_list(news_id: str, limit: int = 100):
    await _news_exists(news_id)
    cursor = (
        db.news_comments.find(
            {"news_id": news_id, "deleted_at": {"$exists": False}}, {"_id": 0}
        )
        .sort("created_at", -1)
        .limit(limit)
    )
    out: List[CommentOut] = []
    async for c in cursor:
        out.append(
            CommentOut(
                comment_id=c["comment_id"],
                news_id=c["news_id"],
                user_id=c["user_id"],
                name=c.get("name", "User"),
                picture=c.get("picture"),
                body=c["body"],
                created_at=c["created_at"],
            )
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
    doc = {
        "comment_id": f"cm_{uuid.uuid4().hex[:12]}",
        "news_id": news_id,
        "user_id": user["user_id"],
        "name": user["name"],
        "picture": user.get("picture"),
        "body": text,
        "created_at": datetime.now(timezone.utc),
    }
    await db.news_comments.insert_one(doc)
    # Notify author on new comments (not self).
    try:
        author_id = news_doc.get("author_id")
        if author_id and author_id != user["user_id"]:
            await push_notification(
                author_id,
                "news_comment",
                f"{user['name']} berkomentar: '{text[:80]}'",
                from_user=user,
            )
    except Exception:
        pass
    return CommentOut(
        comment_id=doc["comment_id"],
        news_id=doc["news_id"],
        user_id=doc["user_id"],
        name=doc["name"],
        picture=doc.get("picture"),
        body=doc["body"],
        created_at=doc["created_at"],
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
ALLOWED_QUIZ_CATEGORIES = {"trivia", "garuda"}


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
    _assert_category(category)
    cursor = db.quiz_items.find(
        {
            "category": category,
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
    except Exception as e:
        logger.warning("index creation issue: %s", e)

    try:
        await run_in_threadpool(init_storage)
    except Exception as e:
        logger.warning("storage init issue: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
