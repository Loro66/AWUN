from typing import Any

import aiohttp

from backend.core.models import Track
from backend.sources.base import AdapterError, BaseAdapter


class JamendoAdapter(BaseAdapter):
    """Jamendo catalog search with artist-authorized download handling."""

    source = "jamendo"
    api_url = "https://api.jamendo.com/v3.0/tracks/"

    def __init__(self, client_id: str, timeout: float = 12.0) -> None:
        self.client_id = client_id.strip()
        self.timeout = timeout
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout),
                headers={"Accept": "application/json", "User-Agent": "AWUN/1.3"},
            )
        return self._session

    async def search(self, query: str, limit: int) -> list[Track]:
        params = {
            "client_id": self.client_id,
            "format": "json",
            "limit": str(limit),
            "search": query,
            "type": "single albumtrack",
            "audioformat": "mp32",
            "audiodlformat": "mp32",
            "imagesize": "300",
        }
        try:
            async with (await self._get_session()).get(self.api_url, params=params) as response:
                if response.status != 200:
                    raise AdapterError(f"Jamendo API returned HTTP {response.status}")
                payload = await response.json(content_type=None)
        except AdapterError:
            raise
        except (aiohttp.ClientError, TimeoutError, ValueError) as exc:
            raise AdapterError(f"Jamendo search failed: {exc}") from exc

        headers = payload.get("headers") if isinstance(payload, dict) else None
        if isinstance(headers, dict) and headers.get("status") == "failed":
            raise AdapterError(str(headers.get("error_message") or "Jamendo request failed"))
        entries = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(entries, list):
            raise AdapterError("Jamendo returned an invalid response")
        return [track for item in entries if (track := self._track_from_item(item))][:limit]

    def _track_from_item(self, item: Any) -> Track | None:
        if not isinstance(item, dict):
            return None
        track_id = str(item.get("id") or "").strip()
        title = str(item.get("name") or "").strip()
        stream_url = str(item.get("audio") or "").strip()
        if not track_id or not title or not stream_url:
            return None
        download_url = str(item.get("audiodownload") or "").strip()
        if item.get("audiodownload_allowed") is not True:
            download_url = ""
        return Track(
            id=f"jamendo_{track_id}",
            title=title,
            artist=str(item.get("artist_name") or "Unknown artist"),
            duration=self._integer(item.get("duration")),
            quality="VBR",
            source=self.source,
            stream_url=stream_url,
            download_url=download_url or None,
            score=82.0,
            thumbnail=item.get("image") or item.get("album_image") or None,
        )

    @staticmethod
    def _integer(value: Any) -> int:
        try:
            return max(0, int(float(value or 0)))
        except (TypeError, ValueError):
            return 0

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
