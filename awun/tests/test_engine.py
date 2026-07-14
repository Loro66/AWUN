import asyncio
import unittest

from backend.core.models import SearchRequest, Track
from backend.search.engine import SearchEngine
from backend.sources.base import BaseAdapter
from backend.sources.youtube import _iso_duration


def make_track(source: str, *, title: str, score: float) -> Track:
    return Track(
        id=f"{source}_{title}",
        title=title,
        artist="Artist",
        duration=180,
        quality="192",
        source=source,
        stream_url="https://example.com/audio",
        download_url="https://example.com/audio",
        score=score,
    )


class FakeAdapter(BaseAdapter):
    def __init__(self, source: str, tracks: list[Track], delay: float = 0) -> None:
        self._source = source
        self.tracks = tracks
        self.delay = delay

    @property
    def source(self):
        return self._source

    async def search(self, query: str, limit: int) -> list[Track]:
        await asyncio.sleep(self.delay)
        return self.tracks[:limit]


class FailingAdapter(FakeAdapter):
    async def search(self, query: str, limit: int) -> list[Track]:
        raise RuntimeError("source unavailable")


class SearchEngineTests(unittest.IsolatedAsyncioTestCase):
    def test_parses_youtube_iso_duration(self) -> None:
        self.assertEqual(_iso_duration("PT3M42S"), 222)
        self.assertEqual(_iso_duration("PT1H2M3S"), 3723)

    async def test_merges_sorts_and_deduplicates_results(self) -> None:
        youtube = FakeAdapter("youtube", [make_track("youtube", title="Song", score=70)])
        soundcloud = FakeAdapter(
            "soundcloud",
            [
                make_track("soundcloud", title="Other", score=80),
                make_track("soundcloud", title="Song", score=90),
            ],
        )
        engine = SearchEngine([youtube, soundcloud])

        response = await engine.search(SearchRequest(query="song", limit=10))

        self.assertEqual([track.title for track in response.tracks], ["Song", "Other"])
        self.assertEqual(response.tracks[0].source, "soundcloud")
        self.assertEqual(response.total, 2)

    async def test_one_source_failure_does_not_fail_search(self) -> None:
        good = FakeAdapter("youtube", [make_track("youtube", title="Song", score=70)])
        bad = FailingAdapter("soundcloud", [])
        response = await SearchEngine([good, bad]).search(SearchRequest(query="song"))

        self.assertEqual(response.total, 1)
        self.assertIn("soundcloud", response.errors)

    async def test_unconfigured_requested_source_is_reported(self) -> None:
        response = await SearchEngine([]).search(
            SearchRequest(query="song", sources=["vk"])
        )
        self.assertEqual(response.searched_sources, [])
        self.assertEqual(response.errors["vk"], "Source is not configured")

    async def test_slow_source_times_out(self) -> None:
        slow = FakeAdapter("youtube", [], delay=0.05)
        response = await SearchEngine([slow], timeout_seconds=0.001).search(
            SearchRequest(query="song")
        )
        self.assertIn("Timed out", response.errors["youtube"])


if __name__ == "__main__":
    unittest.main()
