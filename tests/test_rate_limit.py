import asyncio

import pytest
from backend.reliability.rate_limit import AsyncRateLimiter


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_limiter_waits_when_window_is_full() -> None:
    clock = Clock()
    sleeps: list[float] = []

    async def sleep(delay: float) -> None:
        sleeps.append(delay)
        clock.now += delay

    limiter = AsyncRateLimiter(requests=2, period_seconds=1, clock=clock, sleeper=sleep)

    async def scenario() -> list[float]:
        assert await limiter.acquire() == 0
        assert await limiter.acquire() == 0
        assert limiter.remaining == 0
        assert await limiter.acquire() == 1
        return sleeps

    assert asyncio.run(scenario()) == [1]
    assert sleeps == [1]


def test_expired_requests_restore_capacity() -> None:
    clock = Clock()

    async def sleep(delay: float) -> None:
        clock.now += delay

    limiter = AsyncRateLimiter(requests=1, period_seconds=5, clock=clock, sleeper=sleep)
    async def scenario() -> None:
        await limiter.acquire()
        clock.now = 6

        assert limiter.remaining == 1
        assert await limiter.acquire() == 0

    asyncio.run(scenario())


def test_reset_clears_the_window() -> None:
    limiter = AsyncRateLimiter(requests=2, period_seconds=1)
    limiter._timestamps.extend([1.0, 2.0])
    limiter.reset()

    assert len(limiter._timestamps) == 0


@pytest.mark.parametrize(
    "kwargs",
    [{"requests": 0, "period_seconds": 1}, {"requests": 1, "period_seconds": 0}],
)
def test_invalid_configuration_is_rejected(kwargs: dict[str, int]) -> None:
    with pytest.raises(ValueError):
        AsyncRateLimiter(**kwargs)
