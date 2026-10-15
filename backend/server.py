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
    return UserOut(
        user_id=u["user_id"],
        email=u["email"],
        name=u["name"],
        picture=u.get("picture"),
        username=u["username"],
        is_admin=bool(u.get("is_admin", False)),
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
    doc = {
        "entry_id": f"sc_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "name": user["name"],
        "picture": user.get("picture"),
        "score": int(body.score),
        "mode": body.mode,
        "category": body.category,
        "correct": int(body.correct),
        "total": int(body.total),
        "created_at": datetime.now(timezone.utc),
    }
    await db.scores.insert_one(doc)
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
    return {"ok": True, "score": doc["score"]}


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
    except Exception as e:
        logger.warning("index creation issue: %s", e)

    try:
        await run_in_threadpool(init_storage)
    except Exception as e:
        logger.warning("storage init issue: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
