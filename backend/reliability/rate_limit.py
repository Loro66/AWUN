"""Async sliding-window limiter for provider-specific API quotas."""

import asyncio
from collections import deque
from collections.abc import Awaitable, Callable
from time import monotonic


class AsyncRateLimiter:
    def __init__(
        self,
        *,
        requests: int,
        period_seconds: float,
        clock: Callable[[], float] = monotonic,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if requests < 1:
            raise ValueError("requests must be positive")
        if period_seconds <= 0:
            raise ValueError("period_seconds must be positive")
        self._requests = requests
        self._period = period_seconds
        self._clock = clock
        self._sleep = sleeper
        self._timestamps: deque[float] = deque()
        self._lock = asyncio.Lock()

    def _discard_expired(self, now: float) -> None:
        threshold = now - self._period
        while self._timestamps and self._timestamps[0] <= threshold:
            self._timestamps.popleft()

    @property
    def remaining(self) -> int:
        now = self._clock()
        self._discard_expired(now)
        return max(0, self._requests - len(self._timestamps))

    async def acquire(self) -> float:
        """Wait for capacity, record the request and return wait duration."""

        waited = 0.0
        async with self._lock:
            while True:
                now = self._clock()
                self._discard_expired(now)
                if len(self._timestamps) < self._requests:
                    self._timestamps.append(now)
                    return round(waited, 6)
                delay = max(0.0, self._timestamps[0] + self._period - now)
                await self._sleep(delay)
                waited += delay

    def reset(self) -> None:
        self._timestamps.clear()
