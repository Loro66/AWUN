import pytest

from backend.reliability.source_health import HealthStatus, SourceHealthRegistry


def test_unknown_source_has_neutral_status() -> None:
    registry = SourceHealthRegistry(["youtube"])

    assert registry.get("youtube").status is HealthStatus.UNKNOWN
    assert registry.get("missing").samples == 0


def test_successful_provider_is_healthy() -> None:
    registry = SourceHealthRegistry(["audius"])
    registry.record("audius", success=True, latency_ms=120)
    registry.record("audius", success=True, latency_ms=180)

    health = registry.get("audius")
    assert health.status is HealthStatus.HEALTHY
    assert health.success_rate == 1
    assert health.average_latency_ms == 150
    assert health.last_error is None
    assert health.last_checked_at and health.last_checked_at.endswith("Z")
    assert health.last_success_at == health.last_checked_at


def test_mixed_provider_is_degraded_and_keeps_last_error() -> None:
    registry = SourceHealthRegistry(["soundcloud"])
    registry.record("soundcloud", success=True, latency_ms=100)
    registry.record("soundcloud", success=False, latency_ms=500, error="HTTP 503")

    health = registry.get("soundcloud")
    assert health.status is HealthStatus.DEGRADED
    assert health.success_rate == 0.5
    assert health.last_error == "HTTP 503"
    assert health.last_error_at == health.last_checked_at
    assert health.last_checked_at is not None
    assert health.last_success_at is not None

    registry.record("soundcloud", success=True, latency_ms=90)
    assert registry.get("soundcloud").last_error == "HTTP 503"


def test_diagnostics_redact_provider_credentials() -> None:
    registry = SourceHealthRegistry(["soundcloud"])
    registry.record(
        "soundcloud",
        success=False,
        latency_ms=120,
        error="GET https://api.soundcloud.com/tracks?client_id=secret-token failed; Bearer abc.def",
    )

    error = registry.get("soundcloud").last_error or ""
    assert "secret-token" not in error
    assert "abc.def" not in error
    assert error == "GET https://api.soundcloud.com/tracks?<redacted> failed; Bearer <redacted>"


def test_window_discards_old_failures() -> None:
    registry = SourceHealthRegistry(["jamendo"], window_size=3)
    registry.record("jamendo", success=False, latency_ms=400)
    for _ in range(3):
        registry.record("jamendo", success=True, latency_ms=100)

    assert registry.get("jamendo").status is HealthStatus.HEALTHY
    assert registry.get("jamendo").samples == 3


def test_new_provider_is_included_in_snapshot() -> None:
    registry = SourceHealthRegistry([])
    registry.record("archive", success=False, latency_ms=-10, error="x" * 300)

    snapshot = registry.snapshot()
    assert snapshot["archive"].average_latency_ms == 0
    assert len(snapshot["archive"].last_error or "") == 240


def test_tiny_window_is_rejected() -> None:
    with pytest.raises(ValueError):
        SourceHealthRegistry([], window_size=1)
