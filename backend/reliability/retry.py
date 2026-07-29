"""Bounded asynchronous retry policy for transient provider failures."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import random
from typing import TypeVar


Result = TypeVar("Result")


class RetryExhausted(RuntimeError):
    def __init__(self, attempts: int, last_error: Exception) -> None:
        super().__init__(f"Operation failed after {attempts} attempts: {last_error}")
        self.attempts = attempts
        self.last_error = last_error


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    attempts: int = 3
    base_delay_seconds: float = 0.2
    max_delay_seconds: float = 2.0
    jitter_ratio: float = 0.1

    def __post_init__(self) -> None:
        if self.attempts < 1:
            raise ValueError("attempts must be positive")
        if self.base_delay_seconds < 0 or self.max_delay_seconds < 0:
            raise ValueError("retry delays cannot be negative")
        if not 0 <= self.jitter_ratio <= 1:
            raise ValueError("jitter_ratio must be between zero and one")

    def delay_for(self, failed_attempt: int, *, random_value: float = 0.5) -> float:
        base = min(
            self.max_delay_seconds,
            self.base_delay_seconds * (2 ** max(0, failed_attempt - 1)),
        )
        spread = base * self.jitter_ratio
        return max(0.0, base - spread + 2 * spread * random_value)


async def retry_async(
    operation: Callable[[], Awaitable[Result]],
    *,
    policy: RetryPolicy = RetryPolicy(),
    retryable: tuple[type[Exception], ...] = (TimeoutError, ConnectionError),
    sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> Result:
    """Retry only explicitly transient exceptions and preserve the final cause."""

    last_error: Exception | None = None
    for attempt in range(1, policy.attempts + 1):
        try:
            return await operation()
        except retryable as exc:
            last_error = exc
            if attempt >= policy.attempts:
                break
            await sleeper(policy.delay_for(attempt, random_value=random.random()))
    assert last_error is not None
    raise RetryExhausted(policy.attempts, last_error) from last_error
