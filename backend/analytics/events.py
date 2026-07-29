"""Strict local event schema that excludes arbitrary personal data."""

from dataclasses import dataclass
from enum import Enum
import hashlib
from time import time
from typing import Mapping


class EventName(str, Enum):
    SEARCH_COMPLETED = "search_completed"
    PLAY_STARTED = "play_started"
    TRACK_SAVED = "track_saved"
    TRACK_SKIPPED = "track_skipped"
    IMPORT_COMPLETED = "import_completed"
    FLOW_STARTED = "flow_started"


_ALLOWED_PROPERTIES = {
    "source",
    "region",
    "result_count",
    "elapsed_ms",
    "position",
    "duration_bucket",
    "provider_count",
    "success",
}


def anonymous_session_id(seed: str, *, daily_salt: str) -> str:
    """Create an unlinkable short identifier; callers rotate the salt daily."""

    payload = f"{daily_salt}:{seed}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:20]


def _safe_value(value: object) -> str | int | float | bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return max(-1_000_000, min(value, 1_000_000))
    if isinstance(value, float):
        return round(max(-1_000_000.0, min(value, 1_000_000.0)), 3)
    return str(value or "")[:80]


@dataclass(frozen=True, slots=True)
class AnalyticsEvent:
    name: EventName
    session_id: str
    timestamp: int
    properties: dict[str, str | int | float | bool]

    @classmethod
    def create(
        cls,
        name: EventName,
        *,
        session_id: str,
        properties: Mapping[str, object] | None = None,
        timestamp: int | None = None,
    ) -> "AnalyticsEvent":
        if not session_id or len(session_id) > 64:
            raise ValueError("session_id must contain between 1 and 64 characters")
        safe = {
            key: _safe_value(value)
            for key, value in (properties or {}).items()
            if key in _ALLOWED_PROPERTIES
        }
        return cls(name, session_id, timestamp or int(time()), safe)

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name.value,
            "session_id": self.session_id,
            "timestamp": self.timestamp,
            "properties": dict(self.properties),
        }
