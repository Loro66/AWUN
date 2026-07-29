"""Per-source circuit breaker preventing repeated calls to a failing catalog."""

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from time import monotonic


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass(frozen=True, slots=True)
class CircuitSnapshot:
    state: CircuitState
    consecutive_failures: int
    opened_at: float | None
    retry_after_seconds: float


class CircuitBreaker:
    def __init__(
        self,
        *,
        failure_threshold: int = 3,
        recovery_seconds: float = 30,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        if failure_threshold < 1:
            raise ValueError("failure_threshold must be positive")
        if recovery_seconds <= 0:
            raise ValueError("recovery_seconds must be positive")
        self._threshold = failure_threshold
        self._recovery = recovery_seconds
        self._clock = clock
        self._failures = 0
        self._opened_at: float | None = None
        self._probe_in_flight = False

    @property
    def state(self) -> CircuitState:
        if self._opened_at is None:
            return CircuitState.CLOSED
        if self._clock() - self._opened_at >= self._recovery:
            return CircuitState.HALF_OPEN
        return CircuitState.OPEN

    def allow_request(self) -> bool:
        current = self.state
        if current is CircuitState.CLOSED:
            return True
        if current is CircuitState.OPEN or self._probe_in_flight:
            return False
        self._probe_in_flight = True
        return True

    def record_success(self) -> None:
        self._failures = 0
        self._opened_at = None
        self._probe_in_flight = False

    def record_failure(self) -> None:
        self._probe_in_flight = False
        self._failures += 1
        if self._failures >= self._threshold:
            self._opened_at = self._clock()

    def reset(self) -> None:
        self.record_success()

    @property
    def snapshot(self) -> CircuitSnapshot:
        retry_after = 0.0
        if self.state is CircuitState.OPEN and self._opened_at is not None:
            retry_after = max(0.0, self._recovery - (self._clock() - self._opened_at))
        return CircuitSnapshot(
            state=self.state,
            consecutive_failures=self._failures,
            opened_at=self._opened_at,
            retry_after_seconds=round(retry_after, 3),
        )
