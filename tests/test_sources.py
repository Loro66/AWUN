import unittest

from backend.core.config import Settings
from backend.core.models import SearchRequest
from backend.sources.audius import AudiusAdapter
from backend.sources.factory import build_adapters
from backend.sources.jamendo import JamendoAdapter
from backend.sources.youtube import YouTubeAdapter, _looks_like_track


class ProviderAdapterTests(unittest.TestCase):
    def test_youtube_filters_long_form_mixes_but_keeps_normal_tracks(self) -> None:
        self.assertTrue(_looks_like_track("Artist — Track (Official Audio)", 248))
        self.assertTrue(_looks_like_track("Long classical movement", 1199))
        self.assertFalse(_looks_like_track("Крутая музыка в машину на 3 часа", 10800))
        self.assertFalse(_looks_like_track("Best songs playlist 2026", 540))
        self.assertFalse(_looks_like_track("Artist live now", 0, live=True))

    def test_youtube_api_is_scoped_to_music_category(self) -> None:
        params = YouTubeAdapter(api_key="key")._api_params("track", 10, None)
        self.assertEqual(params["videoCategoryId"], "10")

    def test_audius_maps_stream_and_authorized_download(self) -> None:
        track = AudiusAdapter(app_name="AWUN Test")._track_from_item(
            {
                "id": "D7KyD",
                "title": "Signal",
                "duration": 193,
                "is_streamable": True,
                "is_downloadable": True,
                "play_count": 10000,
                "user": {"name": "Artist"},
                "artwork": {"480x480": "https://images.example/cover.jpg"},
            }
        )

        self.assertIsNotNone(track)
        assert track is not None
        self.assertEqual(track.source, "audius")
        self.assertIn("/tracks/D7KyD/stream?app_name=AWUN+Test", track.stream_url)
        self.assertIn("/tracks/D7KyD/download?app_name=AWUN+Test", track.download_url or "")

    def test_audius_hides_download_without_artist_permission(self) -> None:
        track = AudiusAdapter()._track_from_item(
            {"id": "abc", "title": "Stream only", "is_downloadable": False}
        )
        self.assertIsNotNone(track)
        self.assertIsNone(track.download_url if track else "invalid")

    def test_jamendo_honors_download_permission(self) -> None:
        adapter = JamendoAdapter("client")
        denied = adapter._track_from_item(
            {
                "id": "1",
                "name": "No download",
                "artist_name": "Artist",
                "audio": "https://cdn.example/stream.mp3",
                "audiodownload": "https://cdn.example/download.mp3",
                "audiodownload_allowed": False,
            }
        )
        allowed = adapter._track_from_item(
            {
                "id": "2",
                "name": "Download",
                "audio": "https://cdn.example/stream.mp3",
                "audiodownload": "https://cdn.example/download.mp3",
                "audiodownload_allowed": True,
            }
        )
        self.assertIsNone(denied.download_url if denied else "invalid")
        self.assertEqual(allowed.download_url if allowed else None, "https://cdn.example/download.mp3")

    def test_factory_enables_audius_and_requires_jamendo_client_id(self) -> None:
        settings = Settings(
            youtube_enabled=False,
            soundcloud_enabled=False,
            jamendo_client_id=None,
            _env_file=None,
        )
        self.assertEqual(
            [adapter.source for adapter in build_adapters(settings)],
            ["audius", "internet_archive"],
        )

        settings.jamendo_client_id = "client"
        self.assertEqual(
            [adapter.source for adapter in build_adapters(settings)],
            ["audius", "jamendo", "internet_archive"],
        )

    def test_request_model_accepts_new_sources(self) -> None:
        request = SearchRequest(
            query="signal",
            sources=["audius", "jamendo", "internet_archive"],
            region="latam",
        )
        self.assertEqual(request.sources, ["audius", "jamendo", "internet_archive"])
        self.assertEqual(request.region, "LATAM")


if __name__ == "__main__":
    unittest.main()
