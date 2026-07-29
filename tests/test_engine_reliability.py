import asyncio

from backend.core.models import SearchRequest, Track
from backend.search.engine import SearchEngine
from backend.sources.base import BaseAdapter


def track(title: str, *, score: float = 80) -> Track:
    return Track(
        id=title,
        title=title,
        artist="Artist",
        duration=180,
        quality="192",
        source="audius",
        stream_url="https://example.com/audio",
        score=score,
    )


class CountingAdapter(BaseAdapter):
    def __init__(self, *, fail: bool = False, tracks: list[Track] | None = None) -> None:
        self.fail = fail
        self.tracks = tracks or []
        self.calls = 0

    @property
    def source(self):
        return "audius"

    async def search(self, query: str, limit: int, *, region=None) -> list[Track]:
        self.calls += 1
        if self.fail:
            raise ConnectionError("provider offline")
        return self.tracks[:limit]


def test_repeated_failures_open_source_circuit() -> None:
    adapter = CountingAdapter(fail=True)
    engine = SearchEngine([adapter])

    async def scenario() -> list[str]:
        errors = []
        for _ in range(4):
            response = await engine.search(SearchRequest(query="song"))
            errors.append(response.errors["audius"])
        await engine.close()
        return errors

    errors = asyncio.run(scenario())
    assert adapter.calls == 3
    assert "временно отключён" in errors[-1]
    assert engine.source_health["audius"]["samples"] == 3


def test_successful_search_updates_private_quality_metrics() -> None:
    engine = SearchEngine([CountingAdapter(tracks=[track("Song")])])

    async def scenario() -> None:
        await engine.search(SearchRequest(query="song"))
        await engine.close()

    asyncio.run(scenario())
    assert engine.metrics["searches"] == 1
    assert engine.metrics["successful_searches"] == 1
    assert engine.metrics["sources"]["audius"]["success_rate"] == 1


def test_canonical_identity_deduplicates_provider_labels() -> None:
    clean = track("Song", score=70)
    noisy = track("Song (Official Video)", score=90)

    unique = SearchEngine._deduplicate([noisy, clean])
    assert unique == [noisy]


def test_numbered_results_remain_distinct() -> None:
    first = track("Mix 1")
    second = track("Mix 2")

    assert SearchEngine._deduplicate([first, second]) == [first, second]


def test_health_snapshot_is_json_serializable_data() -> None:
    engine = SearchEngine([CountingAdapter()])
    health = engine.source_health["audius"]

    assert health["status"] == "unknown"
    assert health["samples"] == 0
