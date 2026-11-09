import asyncio
import hashlib
import json
import logging
import time
from contextlib import asynccontextmanager, suppress
from enum import Enum
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

import asyncpg
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis.asyncio import Redis
from redis.exceptions import RedisError

try:
    from .cursors import decode_cursor, encode_cursor, fingerprint
except ImportError:  # Vercel loads this module from the backend service root.
    from cursors import decode_cursor, encode_cursor, fingerprint

log = logging.getLogger("pudi")
SEARCH_SQL = Path(__file__).with_name("search.sql").read_text()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: SecretStr
    redis_url: SecretStr
    allowed_origins: list[str] = Field(min_length=1)
    cursor_signing_key: SecretStr
    session_cookie: str = "__Host-pudi_session"
    redis_namespace: str = "pudi:production"

    @field_validator("cursor_signing_key")
    @classmethod
    def strong_cursor_key(cls, value: SecretStr):
        if len(value.get_secret_value()) < 32:
            raise ValueError("CURSOR_SIGNING_KEY must be at least 32 characters")
        return value

    @field_validator("allowed_origins")
    @classmethod
    def exact_origins(cls, values: list[str]):
        from urllib.parse import urlsplit
        for value in values:
            u = urlsplit(value)
            local_http = u.scheme == "http" and u.hostname in {"localhost", "127.0.0.1"}
            if (u.scheme != "https" and not local_http) or not u.hostname or u.username or u.path or u.query or u.fragment:
                raise ValueError("Use exact HTTPS origins (HTTP is permitted only for localhost development)")
        return values


class Category(str, Enum):
    cattle = "cattle"
    sheep = "sheep"
    goats = "goats"


class Purpose(str, Enum):
    breeding = "breeding"
    slaughter = "slaughter"
    ceremonial = "ceremonial"
    lobola = "lobola"


class ConversationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    listing_id: UUID


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    type: Literal["message"]
    client_message_id: UUID
    body: str = Field(min_length=1, max_length=2000)


RATE_LUA = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
"""


def token_digest(token: str | None) -> bytes:
    if not token or not 32 <= len(token) <= 256:
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    return hashlib.sha256(token.encode()).digest()


async def active_user(pool, digest: bytes) -> UUID | None:
    return await pool.fetchval("""
        SELECT s.user_id FROM auth_sessions s JOIN app_users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL
          AND s.expires_at>now() AND u.disabled_at IS NULL
    """, digest)


async def participant(pool, digest: bytes, conversation_id: UUID) -> UUID | None:
    # Rechecks both session validity and room authorization, including revocation.
    return await pool.fetchval("""
        SELECT s.user_id FROM auth_sessions s
        JOIN app_users u ON u.id=s.user_id AND u.disabled_at IS NULL
        JOIN conversations c ON c.id=$2 AND s.user_id IN (c.buyer_id,c.seller_id)
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
    """, digest, conversation_id)


def message_event(row) -> dict:
    # bigint is serialized as a string to avoid JavaScript precision loss.
    return {"type": "message", "id": str(row["id"]),
            "conversation_id": str(row["conversation_id"]),
            "sender_id": str(row["sender_id"]),
            "client_message_id": str(row["client_message_id"]),
            "body": row["body"], "created_at": row["created_at"].isoformat()}


async def persist_message(pool, conversation_id: UUID, sender_id: UUID, incoming: MessageIn) -> dict:
    async with pool.acquire() as conn, conn.transaction():
        # Serialize writes in a room BEFORE allocating the message identity.
        # History's increasing-ID cursor therefore follows commit order per room.
        allowed = await conn.fetchval("""
            SELECT id FROM conversations WHERE id=$1 AND $2 IN (buyer_id,seller_id) FOR UPDATE
        """, conversation_id, sender_id)
        if not allowed:
            raise PermissionError("Conversation access denied")
        row = await conn.fetchrow("""
            INSERT INTO chat_messages(conversation_id,sender_id,client_message_id,body)
            VALUES($1,$2,$3,$4)
            ON CONFLICT(conversation_id,sender_id,client_message_id) DO NOTHING RETURNING *
        """, conversation_id, sender_id, incoming.client_message_id, incoming.body)
        if row is None:
            row = await conn.fetchrow("""
                SELECT * FROM chat_messages WHERE conversation_id=$1 AND sender_id=$2 AND client_message_id=$3
            """, conversation_id, sender_id, incoming.client_message_id)
            if row["body"] != incoming.body:
                raise ValueError("A message ID cannot be reused with different text")
            return message_event(row)
        event = message_event(row)
        # The message and relay job commit together; no DB/Redis dual-write gap.
        await conn.execute("""
            INSERT INTO chat_outbox(message_id,conversation_id,payload) VALUES($1,$2,$3::jsonb)
        """, row["id"], conversation_id, event)
        return event


async def relay_outbox(pool, redis: Redis, namespace: str):
    while True:
        try:
            async with pool.acquire() as conn, conn.transaction():
                rows = await conn.fetch("""
                    SELECT message_id,conversation_id,payload FROM chat_outbox
                    WHERE delivered_at IS NULL ORDER BY message_id
                    LIMIT 25 FOR UPDATE SKIP LOCKED
                """)
                for row in rows:
                    await redis.publish(f"{namespace}:chat:{row['conversation_id']}", json.dumps(row["payload"]))
                    await conn.execute("UPDATE chat_outbox SET delivered_at=now() WHERE message_id=$1", row["message_id"])
            await asyncio.sleep(0.1 if rows else 0.5)
        except asyncio.CancelledError:
            raise
        except (RedisError, asyncpg.PostgresError, OSError, asyncio.TimeoutError):
            log.warning("Chat relay temporarily unavailable; pending outbox jobs retained")
            await asyncio.sleep(1)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    async def init_connection(conn):
        await conn.set_type_codec("jsonb", schema="pg_catalog", encoder=json.dumps, decoder=json.loads)

    @asynccontextmanager
    async def lifespan(app):
        pool = await asyncpg.create_pool(settings.database_url.get_secret_value(),
                                        min_size=2, max_size=10, command_timeout=10,
                                        server_settings={"statement_timeout": "8000", "application_name": "pudi-api"},
                                        init=init_connection)
        redis = Redis.from_url(settings.redis_url.get_secret_value(), decode_responses=True,
                               socket_timeout=5, socket_connect_timeout=5, max_connections=256)
        try:
            await redis.ping()
            app.state.pool, app.state.redis = pool, redis
            # The durable outbox relay runs in the separately deployed Vercel Daemon.
            # Keep API instances focused on request handling and WebSocket pub/sub.
            yield
        finally:
            await redis.aclose()
            await pool.close()

    app = FastAPI(title="Pudi livestock API", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins,
                       allow_credentials=True, allow_methods=["GET", "POST"],
                       allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def no_private_cache(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    async def authenticated(request: Request) -> tuple[UUID, bytes]:
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.startswith("Bearer ") else request.cookies.get(settings.session_cookie)
        digest = token_digest(token)
        user_id = await active_user(request.app.state.pool, digest)
        if not user_id:
            raise HTTPException(401, "Session expired or revoked")
        # Cookie-authenticated state changes require an exact trusted Origin.
        if request.method not in {"GET", "HEAD", "OPTIONS"} and not auth.startswith("Bearer "):
            if request.headers.get("origin") not in settings.allowed_origins:
                raise HTTPException(403, "Origin not allowed")
        return user_id, digest

    @app.get("/api/listings/nearby")
    async def nearby(request: Request,
                     longitude: Annotated[float, Query(ge=-180, le=180, allow_inf_nan=False)],
                     latitude: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
                     radius_km: Annotated[float, Query(gt=0, le=200, allow_inf_nan=False)] = 50,
                     category: Category | None = None, purpose: Purpose | None = None,
                     verified_only: bool = False,
                     limit: Annotated[int, Query(ge=1, le=100)] = 50,
                     cursor: Annotated[str | None, Query(max_length=1024)] = None):
        filters = {"longitude": longitude, "latitude": latitude, "radius_km": radius_km,
                   "category": category.value if category else None,
                   "purpose": purpose.value if purpose else None, "verified_only": verified_only}
        qhash = fingerprint(filters)
        after_distance, after_id = None, None
        if cursor:
            try:
                after_distance, after_id = decode_cursor(settings.cursor_signing_key.get_secret_value(), cursor, qhash)
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
        rows = await request.app.state.pool.fetch(SEARCH_SQL, longitude, latitude, radius_km*1000,
                                                  filters["category"], filters["purpose"], verified_only,
                                                  after_distance, after_id, limit+1)
        page = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            last = page[-1]
            next_cursor = encode_cursor(settings.cursor_signing_key.get_secret_value(), qhash, last["distance_m"], last["id"])
        features = []
        for row in page:
            features.append({"type": "Feature", "id": str(row["id"]), "geometry": row["geometry"],
                             "properties": {"title": row["title"], "category": row["category"],
                                            "breed": row["breed"], "town": row["town"],
                                            "price_cents": row["price_cents"], "quantity": row["quantity"],
                                            "image_url": row["image_url"], "purpose": row["purpose"],
                                            "seller_name": row["seller_name"],
                                            "is_verified_seller": row["is_verified_seller"],
                                            "distance_km": round(row["distance_m"]/1000, 1)}})
        return JSONResponse({"type": "FeatureCollection", "features": features,
                             "next_cursor": next_cursor, "location_precision": "approximate"},
                            media_type="application/geo+json")

    @app.post("/api/conversations")
    async def start_conversation(body: ConversationIn, request: Request,
                                 auth: tuple[UUID, bytes] = Depends(authenticated)):
        user_id, _ = auth
        async with request.app.state.pool.acquire() as conn, conn.transaction():
            listing = await conn.fetchrow("""
                SELECT l.seller_id FROM livestock_listings l JOIN app_users u ON u.id=l.seller_id
                WHERE l.id=$1 AND l.status='active' AND u.disabled_at IS NULL
            """, body.listing_id)
            if not listing:
                raise HTTPException(404, "Active listing not found")
            if listing["seller_id"] == user_id:
                raise HTTPException(409, "You cannot start a buyer conversation on your own listing")
            row = await conn.fetchrow("""
                INSERT INTO conversations(listing_id,buyer_id,seller_id) VALUES($1,$2,$3)
                ON CONFLICT(listing_id,buyer_id) DO NOTHING RETURNING id
            """, body.listing_id, user_id, listing["seller_id"])
            conversation_id = row["id"] if row else await conn.fetchval(
                "SELECT id FROM conversations WHERE listing_id=$1 AND buyer_id=$2", body.listing_id, user_id)
        return {"id": str(conversation_id), "current_user_id": str(user_id)}

    @app.get("/api/conversations/{conversation_id}/messages")
    async def history(conversation_id: UUID, request: Request,
                      after_id: Annotated[int | None, Query(ge=0, le=9223372036854775807)] = None,
                      before_id: Annotated[int | None, Query(ge=1, le=9223372036854775807)] = None,
                      limit: Annotated[int, Query(ge=1, le=100)] = 100,
                      auth: tuple[UUID, bytes] = Depends(authenticated)):
        if not await participant(request.app.state.pool, auth[1], conversation_id):
            raise HTTPException(404, "Conversation not found")
        if after_id is not None and before_id is not None:
            raise HTTPException(422, "Choose either before_id or after_id")
        if after_id is not None:
            rows = await request.app.state.pool.fetch("""
                SELECT * FROM chat_messages WHERE conversation_id=$1 AND id>$2 ORDER BY id LIMIT $3
            """, conversation_id, after_id, limit+1)
            page = rows[:limit]
        else:
            rows = await request.app.state.pool.fetch("""
                SELECT * FROM chat_messages WHERE conversation_id=$1 AND ($2::bigint IS NULL OR id<$2)
                ORDER BY id DESC LIMIT $3
            """, conversation_id, before_id, limit+1)
            page = list(reversed(rows[:limit]))
        return {"messages": [message_event(r) for r in page], "has_more": len(rows)>limit,
                "next_after_id": str(page[-1]["id"]) if page else str(after_id or 0),
                "next_before_id": str(page[0]["id"]) if page and len(rows)>limit and after_id is None else None}

    @app.websocket("/api/ws/conversations/{conversation_id}")
    async def chat(ws: WebSocket, conversation_id: UUID):
        # Browsers send an HttpOnly session cookie. No tokens in query strings.
        if ws.headers.get("origin") not in settings.allowed_origins:
            await ws.close(code=1008)
            return
        try:
            digest = token_digest(ws.cookies.get(settings.session_cookie))
        except HTTPException:
            await ws.close(code=1008)
            return
        pool, redis = ws.app.state.pool, ws.app.state.redis
        user_id = await participant(pool, digest, conversation_id)
        if not user_id:
            await ws.close(code=1008)
            return
        await ws.accept()
        send_lock = asyncio.Lock()

        async def send(event):
            async with send_lock:
                await asyncio.wait_for(ws.send_json(event), timeout=5)

        async def receive():
            while True:
                raw = await ws.receive_text()
                if len(raw.encode()) > 8192:
                    await ws.close(code=1009)
                    return
                try:
                    incoming = MessageIn.model_validate_json(raw)
                except ValidationError:
                    await send({"type": "error", "code": "invalid_message", "detail": "Use a message UUID and 1–2000 characters of text."})
                    continue
                if await participant(pool, digest, conversation_id) != user_id:
                    await ws.close(code=1008)
                    return
                bucket = int(time.time())//60
                count = await redis.eval(RATE_LUA, 1, f"{settings.redis_namespace}:chat-rate:{user_id}:{bucket}", 65)
                if count > 30:
                    await send({"type": "error", "code": "rate_limited", "detail": "Limit: 30 messages per minute."})
                    continue
                try:
                    event = await persist_message(pool, conversation_id, user_id, incoming)
                except ValueError as exc:
                    await send({"type": "error", "code": "message_id_conflict", "detail": str(exc)})
                    continue
                await send(event)  # Acknowledges a committed message, not delivery/read status.

        async def forward(pubsub):
            checked_at = time.monotonic()
            while True:
                item = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
                if item or time.monotonic()-checked_at >= 30:
                    if await participant(pool, digest, conversation_id) != user_id:
                        await ws.close(code=1008)
                        return
                    checked_at = time.monotonic()
                if item:
                    await send(json.loads(item["data"]))
                await asyncio.sleep(0)

        tasks = []
        try:
            async with redis.pubsub() as pubsub:
                await pubsub.subscribe(f"{settings.redis_namespace}:chat:{conversation_id}")
                await send({"type": "ready", "current_user_id": str(user_id)})
                tasks = [asyncio.create_task(receive()), asyncio.create_task(forward(pubsub))]
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
        except WebSocketDisconnect:
            pass
        except (RedisError, asyncpg.PostgresError, PermissionError, asyncio.TimeoutError, RuntimeError):
            log.warning("Chat connection interrupted; persisted history remains available")
            with suppress(RuntimeError, WebSocketDisconnect):
                await ws.close(code=1013)
        finally:
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

    return app
