"""Call from your existing login handler only after identity authentication succeeds."""
import hashlib
import secrets
from datetime import datetime,timedelta,timezone
from uuid import UUID


async def issue_authenticated_session(conn, response, user_id: UUID, *, cookie_name="__Host-pudi_session", secure=True):
    # This is not an unauthenticated login endpoint; caller must authenticate first.
    token=secrets.token_urlsafe(32)
    expiry=datetime.now(timezone.utc)+timedelta(hours=8)
    inserted=await conn.fetchval("""
        INSERT INTO auth_sessions(token_hash,user_id,expires_at)
        SELECT $1,id,$3 FROM app_users WHERE id=$2 AND disabled_at IS NULL
        RETURNING user_id
    """,hashlib.sha256(token.encode()).digest(),user_id,expiry)
    if not inserted:
        raise PermissionError("Active authenticated account required")
    response.set_cookie(cookie_name,token,httponly=True,secure=secure,samesite="lax",path="/",expires=expiry)
    return expiry
