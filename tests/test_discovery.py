import unittest

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


if __name__ == "__main__":
    unittest.main()
