"""Rolling health summaries for independent music providers."""

from collections import deque
from dataclasses import dataclass, field
from enum import Enum


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


@dataclass(frozen=True, slots=True)
class SourceHealth:
    status: HealthStatus
    success_rate: float
    average_latency_ms: int
    samples: int
    last_error: str | None


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
        samples.last_error = None if success else (error or "unknown provider error")[:240]

    def get(self, source: str) -> SourceHealth:
        samples = self._sources.get(source)
        if samples is None or not samples.outcomes:
            return SourceHealth(HealthStatus.UNKNOWN, 0.0, 0, 0, None)
        successes = sum(samples.outcomes)
        rate = successes / len(samples.outcomes)
        if rate >= 0.8:
            status = HealthStatus.HEALTHY
        elif rate >= 0.35:
            status = HealthStatus.DEGRADED
        else:
            status = HealthStatus.UNAVAILABLE
        latency = round(sum(samples.latencies_ms) / len(samples.latencies_ms))
        return SourceHealth(status, round(rate, 3), latency, len(samples.outcomes), samples.last_error)

    def snapshot(self) -> dict[str, SourceHealth]:
        return {source: self.get(source) for source in self._sources}
