import unittest

from backend.core.media import InvalidMediaToken, MediaSigner


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


if __name__ == "__main__":
    unittest.main()
