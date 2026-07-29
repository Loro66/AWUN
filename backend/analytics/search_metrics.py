"""In-memory search quality metrics without storing query text."""

from collections import defaultdict, deque
from dataclasses import dataclass, field
from math import ceil


def _percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, ceil(len(ordered) * fraction) - 1))
    return ordered[index]


@dataclass(slots=True)
class SourceMetric:
    attempts: int = 0
    successes: int = 0
    result_count: int = 0
    latencies_ms: deque[int] = field(default_factory=lambda: deque(maxlen=500))


@dataclass(frozen=True, slots=True)
class SearchMetricSnapshot:
    searches: int
    successful_searches: int
    success_rate: float
    average_results: float
    latency_p50_ms: int
    latency_p95_ms: int
    sources: dict[str, dict[str, float | int]]


class SearchMetrics:
    def __init__(self, *, window_size: int = 1000) -> None:
        if window_size < 10:
            raise ValueError("window_size must be at least ten")
        self._latencies: deque[int] = deque(maxlen=window_size)
        self._result_counts: deque[int] = deque(maxlen=window_size)
        self._sources: defaultdict[str, SourceMetric] = defaultdict(SourceMetric)

    def record_search(self, *, elapsed_ms: int, result_count: int) -> None:
        self._latencies.append(max(0, elapsed_ms))
        self._result_counts.append(max(0, result_count))

    def record_source(
        self,
        source: str,
        *,
        success: bool,
        elapsed_ms: int,
        result_count: int,
    ) -> None:
        metric = self._sources[source]
        metric.attempts += 1
        metric.successes += int(success)
        metric.result_count += max(0, result_count)
        metric.latencies_ms.append(max(0, elapsed_ms))

    def snapshot(self) -> SearchMetricSnapshot:
        latencies = list(self._latencies)
        counts = list(self._result_counts)
        source_data: dict[str, dict[str, float | int]] = {}
        for name, metric in sorted(self._sources.items()):
            source_data[name] = {
                "attempts": metric.attempts,
                "success_rate": round(metric.successes / metric.attempts, 3)
                if metric.attempts
                else 0.0,
                "average_results": round(metric.result_count / metric.attempts, 2)
                if metric.attempts
                else 0.0,
                "latency_p95_ms": _percentile(list(metric.latencies_ms), 0.95),
            }
        successful = sum(count > 0 for count in counts)
        return SearchMetricSnapshot(
            searches=len(counts),
            successful_searches=successful,
            success_rate=round(successful / len(counts), 3) if counts else 0.0,
            average_results=round(sum(counts) / len(counts), 2) if counts else 0.0,
            latency_p50_ms=_percentile(latencies, 0.5),
            latency_p95_ms=_percentile(latencies, 0.95),
            sources=source_data,
        )
