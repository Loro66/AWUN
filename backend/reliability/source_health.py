"""Rolling health summaries for independent music providers."""

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import re


_URL_QUERY = re.compile(r"(https?://[^\s?#]+)[?#][^\s]+", re.IGNORECASE)
_SECRET_VALUE = re.compile(
    r"(?i)(\b(?:api[_-]?key|client[_-]?(?:id|secret)|access[_-]?token|token|signature|authorization)\s*[:=]\s*)[^\s,&]+"
)
_BEARER = re.compile(r"(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]+")


def _safe_error(value: str | None) -> str:
    message = str(value or "unknown provider error")
    message = _URL_QUERY.sub(r"\1?<redacted>", message)
    message = _SECRET_VALUE.sub(r"\1<redacted>", message)
    message = _BEARER.sub(r"\1<redacted>", message)
    return message[:240]


class HealthStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"


@dataclass(slots=True)
class SourceSamples:
    outcomes: deque[bool] = field(default_factory=lambda: deque(maxlen=20))
    latencies_ms: deque[int] = field(default_factory=lambda: deque(maxlen=20))
    last_error: str | None = None
    last_error_at: str | None = None
    last_checked_at: str | None = None
    last_success_at: str | None = None


@dataclass(frozen=True, slots=True)
class SourceHealth:
    status: HealthStatus
    success_rate: float
    average_latency_ms: int
    samples: int
    last_error: str | None
    last_error_at: str | None
    last_checked_at: str | None
    last_success_at: str | None


class SourceHealthRegistry:
    def __init__(self, sources: list[str], *, window_size: int = 20) -> None:
        if window_size < 2:
            raise ValueError("window_size must be at least two")
        self._window = window_size
        self._sources = {
            source: SourceSamples(deque(maxlen=window_size), deque(maxlen=window_size))
            for source in sources
        }

    def record(self, source: str, *, success: bool, latency_ms: int, error: str | None = None) -> None:
        samples = self._sources.setdefault(
            source,
            SourceSamples(deque(maxlen=self._window), deque(maxlen=self._window)),
        )
        samples.outcomes.append(success)
        samples.latencies_ms.append(max(0, latency_ms))
        now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        samples.last_checked_at = now
        if success:
            samples.last_success_at = now
        else:
            samples.last_error = _safe_error(error)
            samples.last_error_at = now

    def get(self, source: str) -> SourceHealth:
        samples = self._sources.get(source)
        if samples is None or not samples.outcomes:
            return SourceHealth(HealthStatus.UNKNOWN, 0.0, 0, 0, None, None, None, None)
        successes = sum(samples.outcomes)
        rate = successes / len(samples.outcomes)
        if rate >= 0.8:
            status = HealthStatus.HEALTHY
        elif rate >= 0.35:
            status = HealthStatus.DEGRADED
        else:
            status = HealthStatus.UNAVAILABLE
        latency = round(sum(samples.latencies_ms) / len(samples.latencies_ms))
        return SourceHealth(
            status,
            round(rate, 3),
            latency,
            len(samples.outcomes),
            samples.last_error,
            samples.last_error_at,
            samples.last_checked_at,
            samples.last_success_at,
        )

    def snapshot(self) -> dict[str, SourceHealth]:
        return {source: self.get(source) for source in self._sources}
