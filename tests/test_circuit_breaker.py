import pytest

from backend.reliability.circuit_breaker import CircuitBreaker, CircuitState


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_circuit_opens_after_consecutive_failures() -> None:
    clock = Clock()
    breaker = CircuitBreaker(failure_threshold=2, recovery_seconds=10, clock=clock)

    assert breaker.allow_request()
    breaker.record_failure()
    assert breaker.state is CircuitState.CLOSED
    breaker.record_failure()

    assert breaker.state is CircuitState.OPEN
    assert breaker.allow_request() is False
    assert breaker.snapshot.retry_after_seconds == 10


def test_only_one_half_open_probe_is_allowed() -> None:
    clock = Clock()
    breaker = CircuitBreaker(failure_threshold=1, recovery_seconds=10, clock=clock)
    breaker.record_failure()
    clock.now = 10

    assert breaker.state is CircuitState.HALF_OPEN
    assert breaker.allow_request() is True
    assert breaker.allow_request() is False
    breaker.record_success()
    assert breaker.state is CircuitState.CLOSED


def test_failed_probe_reopens_recovery_window() -> None:
    clock = Clock()
    breaker = CircuitBreaker(failure_threshold=1, recovery_seconds=10, clock=clock)
    breaker.record_failure()
    clock.now = 10
    assert breaker.allow_request()
    breaker.record_failure()

    assert breaker.state is CircuitState.OPEN
    assert breaker.snapshot.opened_at == 10


@pytest.mark.parametrize(
    "kwargs",
    [{"failure_threshold": 0}, {"recovery_seconds": 0}],
)
def test_invalid_configuration_is_rejected(kwargs: dict[str, int]) -> None:
    with pytest.raises(ValueError):
        CircuitBreaker(**kwargs)
