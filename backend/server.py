from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

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


class SessionExchangeOut(BaseModel):
    session_token: str
    user: UserOut


class ScoreSubmit(BaseModel):
    score: int
    mode: str  # "classic" or "time_attack"
    category: str  # "all" | "guess" | "history" | "trivia"
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


# ---------- Auth helpers ----------
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
    return user


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
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "created_at": datetime.now(timezone.utc),
            }
        )

    await db.user_sessions.insert_one(
        {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": datetime.now(timezone.utc),
        }
    )

    return SessionExchangeOut(
        session_token=session_token,
        user=UserOut(user_id=user_id, email=email, name=name, picture=picture),
    )


@api_router.get("/auth/me", response_model=UserOut)
async def auth_me(user: dict = Depends(get_current_user)):
    return UserOut(
        user_id=user["user_id"], email=user["email"], name=user["name"], picture=user.get("picture")
    )


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Leaderboard ----------
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
    # keep best per user per mode in `best_scores`
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
async def leaderboard(mode: str = "classic", limit: int = 50):
    cursor = (
        db.best_scores.find({"mode": mode}, {"_id": 0}).sort("score", -1).limit(limit)
    )
    results = []
    async for doc in cursor:
        results.append(LeaderboardEntry(**doc))
    return results


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
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.best_scores.create_index([("mode", 1), ("score", -1)])
        await db.best_scores.create_index([("user_id", 1), ("mode", 1)], unique=True)
    except Exception as e:
        logger.warning("index creation issue: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
