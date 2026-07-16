import unittest
from unittest.mock import patch

from backend.core.regions import resolve_region
from backend.search.enrichment import MusicBrainzEnricher, transliterate_cyrillic
from backend.sources.internet_archive import InternetArchiveAdapter
from backend.sources.youtube import YouTubeAdapter


class RegionalDiscoveryTests(unittest.TestCase):
    def test_auto_region_uses_browser_locale(self) -> None:
        profile = resolve_region("AUTO", "es-MX")
        self.assertEqual(profile.country, "MX")
        self.assertEqual(profile.language, "es")
        self.assertEqual(profile.apple_storefront, "mx")

    def test_youtube_api_receives_region_and_language(self) -> None:
        params = YouTubeAdapter("key")._api_params(
            "artist track",
            10,
            resolve_region("CIS"),
        )
        self.assertEqual(params["regionCode"], "RU")
        self.assertEqual(params["relevanceLanguage"], "ru")

    def test_youtube_result_pages_are_bounded_and_support_fifty_per_page(self) -> None:
        adapter = YouTubeAdapter("key", max_pages=99)
        params = adapter._api_params("artist track", 100, resolve_region("GLOBAL"))
        self.assertEqual(adapter._max_pages, 2)
        self.assertEqual(params["maxResults"], 50)

    def test_musicbrainz_builds_alias_release_and_isrc_queries(self) -> None:
        payload = {
            "recordings": [
                {
                    "title": "Группа крови",
                    "artist-credit": [{"artist": {"name": "Кино"}}],
                    "releases": [{"title": "Последний герой"}],
                    "isrcs": ["RUA1A0100001"],
                }
            ]
        }
        variants = MusicBrainzEnricher.variants_from_payload(
            "Кино группа крови",
            payload,
            resolve_region("CIS"),
            aliases=[{"name": "Kino", "locale": "en"}],
        )
        self.assertIn("Kino gruppa krovi", variants)
        self.assertIn("RUA1A0100001", variants)
        self.assertTrue(any("Последний герой" in variant for variant in variants))
        self.assertEqual(transliterate_cyrillic("Кино"), "Kino")

    def test_archive_metadata_yields_real_audio_and_skips_playlists(self) -> None:
        tracks = InternetArchiveAdapter.tracks_from_metadata(
            {
                "metadata": {"identifier": "open-album", "title": "Open Album", "creator": "Artist"},
                "files": [
                    {"name": "track.mp3", "title": "Rare Track", "length": "3:42", "source": "original"},
                    {"name": "playlist.m3u8", "title": "Stream manifest"},
                ],
            },
            "Rare Track",
        )
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0].source, "internet_archive")
        self.assertEqual(tracks[0].duration, 222)
        self.assertEqual(tracks[0].stream_url, tracks[0].download_url)
        self.assertTrue(tracks[0].download_url.endswith("/track.mp3"))


class _FakeResponse:
    def __init__(self, payload: dict, status: int = 200) -> None:
        self.payload = payload
        self.status = status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def json(self, content_type=None):
        return self.payload


class _FakeYouTubeSession:
    def __init__(self) -> None:
        self.search_calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    def get(self, url: str, params: dict):
        if url.endswith("/search"):
            start = 0 if not params.get("pageToken") else 50
            count = 50 if start == 0 else 10
            self.search_calls += 1
            return _FakeResponse(
                {
                    "items": [
                        {
                            "id": {"videoId": f"video{index:05d}"},
                            "snippet": {"title": f"Song {index}", "channelTitle": "Artist"},
                        }
                        for index in range(start, start + count)
                    ],
                    "nextPageToken": "page-2" if start == 0 else None,
                }
            )
        ids = str(params.get("id") or "").split(",")
        return _FakeResponse(
            {
                "items": [
                    {
                        "id": video_id,
                        "contentDetails": {"duration": "PT3M"},
                        "status": {"embeddable": True},
                    }
                    for video_id in ids
                    if video_id
                ]
            }
        )


class YoutubePaginationTests(unittest.IsolatedAsyncioTestCase):
    async def test_youtube_fetches_second_page_for_sixty_results(self) -> None:
        session = _FakeYouTubeSession()
        with patch("backend.sources.youtube.aiohttp.ClientSession", return_value=session):
            tracks = await YouTubeAdapter("key", max_pages=2)._search_api(
                "artist track",
                60,
                region=resolve_region("USA"),
            )
        self.assertEqual(session.search_calls, 2)
        self.assertEqual(len(tracks), 60)
        self.assertEqual(tracks[-1].title, "Song 59")


if __name__ == "__main__":
    unittest.main()
