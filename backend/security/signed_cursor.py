"""Short-lived HMAC cursors for stateless search pagination."""

import base64
from dataclasses import dataclass
import hashlib
import hmac
import json
from time import time
from typing import Callable


class InvalidCursor(ValueError):
    """Raised for expired, malformed or forged pagination cursors."""


@dataclass(frozen=True, slots=True)
class CursorPayload:
    offset: int
    query_hash: str
    expires_at: int


def query_fingerprint(query: str) -> str:
    normalized = " ".join(query.casefold().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


class CursorSigner:
    def __init__(
        self,
        secret: str,
        *,
        ttl_seconds: int = 900,
        clock: Callable[[], float] = time,
    ) -> None:
        if len(secret) < 16:
            raise ValueError("cursor secret must contain at least 16 characters")
        if ttl_seconds < 30:
            raise ValueError("cursor ttl must be at least 30 seconds")
        self._secret = secret.encode("utf-8")
        self._ttl = ttl_seconds
        self._clock = clock

    def encode(self, *, query: str, offset: int) -> str:
        if offset < 0:
            raise ValueError("cursor offset cannot be negative")
        payload = {
            "o": offset,
            "q": query_fingerprint(query),
            "e": int(self._clock()) + self._ttl,
        }
        raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        signature = hmac.new(self._secret, raw, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(raw + signature).decode("ascii").rstrip("=")

    def decode(self, token: str, *, query: str) -> CursorPayload:
        try:
            padded = token + "=" * (-len(token) % 4)
            packed = base64.urlsafe_b64decode(padded.encode("ascii"))
            raw, signature = packed[:-32], packed[-32:]
            expected = hmac.new(self._secret, raw, hashlib.sha256).digest()
            if not hmac.compare_digest(signature, expected):
                raise InvalidCursor("cursor signature is invalid")
            data = json.loads(raw)
            payload = CursorPayload(int(data["o"]), str(data["q"]), int(data["e"]))
        except InvalidCursor:
            raise
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise InvalidCursor("cursor is malformed") from exc
        if payload.query_hash != query_fingerprint(query):
            raise InvalidCursor("cursor belongs to another query")
        if payload.expires_at < int(self._clock()):
            raise InvalidCursor("cursor has expired")
        if payload.offset < 0:
            raise InvalidCursor("cursor offset is invalid")
        return payload
