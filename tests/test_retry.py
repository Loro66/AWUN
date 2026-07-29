import asyncio

import pytest
from backend.reliability.retry import RetryExhausted, RetryPolicy, retry_async


def test_transient_operation_eventually_succeeds() -> None:
    attempts = 0
    delays: list[float] = []

    async def operation() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise TimeoutError("slow provider")
        return "ok"

    async def sleep(delay: float) -> None:
        delays.append(delay)

    result = asyncio.run(
        retry_async(
            operation,
            policy=RetryPolicy(attempts=3, base_delay_seconds=1, jitter_ratio=0),
            sleeper=sleep,
        )
    )

    assert result == "ok"
    assert attempts == 3
    assert delays == [1, 2]


def test_non_retryable_error_is_raised_immediately() -> None:
    async def operation() -> None:
        raise ValueError("bad payload")

    with pytest.raises(ValueError, match="bad payload"):
        asyncio.run(retry_async(operation))


def test_exhausted_error_keeps_last_exception() -> None:
    async def operation() -> None:
        raise ConnectionError("offline")

    async def no_sleep(delay: float) -> None:
        return None

    with pytest.raises(RetryExhausted) as caught:
        asyncio.run(retry_async(operation, policy=RetryPolicy(attempts=2), sleeper=no_sleep))

    assert caught.value.attempts == 2
    assert isinstance(caught.value.last_error, ConnectionError)


def test_delay_is_exponential_and_capped() -> None:
    policy = RetryPolicy(base_delay_seconds=1, max_delay_seconds=3, jitter_ratio=0)

    assert [policy.delay_for(index) for index in range(1, 5)] == [1, 2, 3, 3]
