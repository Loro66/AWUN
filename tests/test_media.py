import unittest

from backend.core.media import InvalidMediaToken, MediaSigner
from backend.api.main import _download_filename, _is_playlist, _safe_filename_stem


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
        with self.assertRaisesRegex(InvalidMediaToken, "expired"):
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


if __name__ == "__main__":
    unittest.main()
