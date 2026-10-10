import base64
import hashlib
import hmac
import json
import math
import time
from uuid import UUID


def fingerprint(filters: dict) -> str:
    raw = json.dumps(filters, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def encode_cursor(key: str, query_hash: str, distance: float, listing_id: UUID) -> str:
    payload = json.dumps({"q": query_hash, "d": distance, "id": str(listing_id),
                          "exp": int(time.time()) + 3600}, separators=(",", ":")).encode()
    signed = payload + hmac.new(key.encode(), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(signed).decode().rstrip("=")


def decode_cursor(key: str, cursor: str, query_hash: str) -> tuple[float, UUID]:
    try:
        if len(cursor) > 1024:
            raise ValueError
        raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        payload, signature = raw[:-32], raw[-32:]
        if not hmac.compare_digest(signature, hmac.new(key.encode(), payload, hashlib.sha256).digest()):
            raise ValueError
        value = json.loads(payload)
        d = float(value["d"])
        if value["q"] != query_hash or value["exp"] < time.time() or not math.isfinite(d) or d < 0:
            raise ValueError
        return d, UUID(value["id"])
    except (ValueError, TypeError, KeyError, UnicodeDecodeError) as exc:
        raise ValueError("Invalid, expired, or mismatched search cursor") from exc
