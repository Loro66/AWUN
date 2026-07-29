import unittest

from backend.core.media import InvalidMediaToken, MediaSigner
from backend.core.models import SearchResponse, Track
from backend.api.main import _apply_client_policy, _download_filename, _is_playlist, _safe_filename_stem


class MediaSignerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.signer = MediaSigner("a-production-length-test-secret", ttl_seconds=60)

    def test_round_trip(self) -> None:
        url = "https://media.example.com/audio.mp3?signature=abc"
        token = self.signer.sign(url, {"Referer": "https://example.com/", "Cookie": "no"}, now=100)
        target = self.signer.verify(token, now=120)
        self.assertEqual(target.url, url)
        self.assertEqual(target.headers, {"Referer": "https://example.com/"})

    def test_rejects_expired_token(self) -> None:
        token = self.signer.sign("https://media.example.com/audio.mp3", now=100)
        with self.assertRaisesRegex(InvalidMediaToken, "устарела"):
            self.signer.verify(token, now=161)

    def test_rejects_tampering(self) -> None:
        token = self.signer.sign("https://media.example.com/audio.mp3", now=100)
        payload, signature = token.split(".", 1)
        with self.assertRaises(InvalidMediaToken):
            self.signer.verify(f"{payload}x.{signature}", now=120)

    def test_rejects_non_http_url(self) -> None:
        with self.assertRaises(InvalidMediaToken):
            self.signer.sign("file:///etc/passwd", now=100)

    def test_download_filename_is_safe_and_uses_media_type(self) -> None:
        self.assertEqual(
            _download_filename('Artist / Track: "Live"', "audio/mpeg", "https://media.example/file"),
            "Artist Track Live.mp3",
        )
        self.assertEqual(_safe_filename_stem("../bad\\name"), "bad name")

    def test_playlist_detection(self) -> None:
        self.assertTrue(_is_playlist("https://media.example/playlist.m3u8", "application/octet-stream"))
        self.assertTrue(_is_playlist("https://media.example/audio", "application/vnd.apple.mpegurl"))
        self.assertFalse(_is_playlist("https://media.example/audio.mp3", "audio/mpeg"))

    def test_google_play_client_never_receives_download_url(self) -> None:
        track = Track(
            id="a1",
            title="Signal",
            artist="Neon Echo",
            duration=200,
            quality="320",
            source="audius",
            stream_url="https://media.example/signal.mp3",
            download_url="https://media.example/signal.mp3",
            score=90,
        )
        response = SearchResponse(
            query="Signal",
            tracks=[track],
            total=1,
            searched_sources=["audius"],
            region="AUTO",
            elapsed_ms=1,
        )

        protected = _apply_client_policy(response, "android-play")

        self.assertIsNone(protected.tracks[0].download_url)
        self.assertEqual(protected.tracks[0].stream_url, "https://media.example/signal.mp3")
        self.assertEqual(protected.tracks[0].rights_status, "play_store_stream_only")
        self.assertIn("audius", protected.tracks[0].rights_terms_url or "")

    def test_desktop_policy_keeps_provider_download_and_marks_it(self) -> None:
        track = Track(
            id="archive-1",
            title="Public recording",
            artist="Archive artist",
            duration=180,
            quality="vbr",
            source="internet_archive",
            stream_url="https://archive.org/audio.mp3",
            download_url="https://archive.org/audio.mp3",
            score=80,
        )
        response = SearchResponse(
            query="Public recording",
            tracks=[track],
            total=1,
            searched_sources=["internet_archive"],
            region="AUTO",
            elapsed_ms=1,
        )

        protected = _apply_client_policy(response, "desktop")

        self.assertEqual(protected.tracks[0].download_url, track.download_url)
        self.assertEqual(protected.tracks[0].rights_status, "provider_supplied_download")
        self.assertIn("archive.org", protected.tracks[0].rights_terms_url or "")


if __name__ == "__main__":
    unittest.main()
