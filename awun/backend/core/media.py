import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import urlparse


class InvalidMediaToken(ValueError):
    pass


@dataclass(frozen=True)
class MediaTarget:
    url: str
    headers: dict[str, str]


class MediaSigner:
    def __init__(self, secret: str, ttl_seconds: int = 1800) -> None:
        self._secret = secret.encode("utf-8")
        self._ttl = ttl_seconds

    def sign(self, url: str, headers: dict[str, str] | None = None, now: int | None = None) -> str:
        self._validate_url(url)
        payload = json.dumps(
            {
                "url": url,
                "headers": self._safe_headers(headers or {}),
                "expires": (now or int(time.time())) + self._ttl,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        encoded = base64.urlsafe_b64encode(payload).rstrip(b"=")
        signature = hmac.new(self._secret, encoded, hashlib.sha256).digest()
        return f"{encoded.decode()}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"

    def verify(self, token: str, now: int | None = None) -> MediaTarget:
        try:
            encoded, supplied_signature = token.split(".", 1)
            expected = hmac.new(self._secret, encoded.encode(), hashlib.sha256).digest()
            supplied = self._decode(supplied_signature)
            if not hmac.compare_digest(expected, supplied):
                raise InvalidMediaToken("Invalid signature")
            payload = json.loads(self._decode(encoded))
            if int(payload["expires"]) < (now or int(time.time())):
                raise InvalidMediaToken("Media link expired")
            url = str(payload["url"])
            self._validate_url(url)
            return MediaTarget(url=url, headers=self._safe_headers(payload.get("headers") or {}))
        except InvalidMediaToken:
            raise
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise InvalidMediaToken("Invalid media token") from exc

    @staticmethod
    def _decode(value: str) -> bytes:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

    @staticmethod
    def _validate_url(url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise InvalidMediaToken("Invalid media URL")

    @staticmethod
    def _safe_headers(headers: dict[str, str]) -> dict[str, str]:
        allowed = {
            "user-agent": "User-Agent",
            "referer": "Referer",
            "origin": "Origin",
            "accept": "Accept",
            "accept-language": "Accept-Language",
        }
        return {
            allowed[str(key).lower()]: str(value)
            for key, value in headers.items()
            if str(key).lower() in allowed and "\n" not in str(value) and "\r" not in str(value)
        }
