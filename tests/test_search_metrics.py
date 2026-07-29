import pytest

from backend.analytics.search_metrics import SearchMetrics


def test_empty_snapshot_has_zeroes() -> None:
    snapshot = SearchMetrics().snapshot()

    assert snapshot.searches == 0
    assert snapshot.success_rate == 0
    assert snapshot.sources == {}


def test_search_success_and_latency_percentiles_are_calculated() -> None:
    metrics = SearchMetrics()
    for latency, count in [(100, 3), (200, 0), (300, 7), (1000, 1)]:
        metrics.record_search(elapsed_ms=latency, result_count=count)

    snapshot = metrics.snapshot()
    assert snapshot.searches == 4
    assert snapshot.successful_searches == 3
    assert snapshot.success_rate == 0.75
    assert snapshot.average_results == 2.75
    assert snapshot.latency_p50_ms == 200
    assert snapshot.latency_p95_ms == 1000


def test_source_metrics_are_aggregated_without_queries() -> None:
    metrics = SearchMetrics()
    metrics.record_source("youtube", success=True, elapsed_ms=100, result_count=4)
    metrics.record_source("youtube", success=False, elapsed_ms=500, result_count=0)

    source = metrics.snapshot().sources["youtube"]
    assert source["attempts"] == 2
    assert source["success_rate"] == 0.5
    assert source["average_results"] == 2
    assert source["latency_p95_ms"] == 500


def test_negative_provider_values_are_clamped() -> None:
    metrics = SearchMetrics()
    metrics.record_search(elapsed_ms=-1, result_count=-5)
    metrics.record_source("audius", success=True, elapsed_ms=-1, result_count=-4)

    assert metrics.snapshot().latency_p50_ms == 0
    assert metrics.snapshot().sources["audius"]["average_results"] == 0


def test_tiny_window_is_rejected() -> None:
    with pytest.raises(ValueError):
        SearchMetrics(window_size=5)
