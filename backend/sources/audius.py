import math
from typing import Any
from urllib.parse import urlencode

import aiohttp

from backend.core.models import Track
from backend.core.regions import RegionProfile
from backend.sources.base import AdapterError, BaseAdapter


class AudiusAdapter(BaseAdapter):
    """Read-only Audius search with first-party full-track media endpoints."""

    source = "audius"
    api_url = "https://api.audius.co/v1"

    def __init__(
        self,
        app_name: str = "AWUN",
        api_key: str | None = None,
        timeout: float = 12.0,
    ) -> None:
        self.app_name = app_name.strip() or "AWUN"
        self.api_key = api_key
        self.timeout = timeout
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            headers = {"Accept": "application/json", "User-Agent": "AWUN/1.5"}
            if self.api_key:
                headers["x-api-key"] = self.api_key
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout),
                headers=headers,
            )
        return self._session

    async def search(
        self,
        query: str,
        limit: int,
        *,
        region: RegionProfile | None = None,
    ) -> list[Track]:
        session = await self._get_session()
        params = {"query": query, "limit": str(limit), "app_name": self.app_name}
        try:
            async with session.get(f"{self.api_url}/tracks/search", params=params) as response:
                if response.status != 200:
                    raise AdapterError(f"Audius API returned HTTP {response.status}")
                payload = await response.json(content_type=None)
        except AdapterError:
            raise
        except (aiohttp.ClientError, TimeoutError, ValueError) as exc:
            raise AdapterError(f"Audius search failed: {exc}") from exc

        entries = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(entries, list):
            raise AdapterError("Audius returned an invalid response")
        return [track for item in entries if (track := self._track_from_item(item))][:limit]

    def _track_from_item(self, item: Any) -> Track | None:
        if not isinstance(item, dict):
            return None
        track_id = str(item.get("id") or "").strip()
        title = str(item.get("title") or "").strip()
        if not track_id or not title or item.get("is_streamable") is False:
            return None

        user = item.get("user") if isinstance(item.get("user"), dict) else {}
        artwork = item.get("artwork") if isinstance(item.get("artwork"), dict) else {}
        query = urlencode({"app_name": self.app_name})
        stream_url = f"{self.api_url}/tracks/{track_id}/stream?{query}"
        download_url = (
            f"{self.api_url}/tracks/{track_id}/download?{query}"
            if item.get("is_downloadable") is True
            else None
        )
        plays = self._integer(item.get("play_count"))
        score = min(94.0, 78.0 + math.log10(max(1, plays)) * 2.2)
        return Track(
            id=f"audius_{track_id}",
            title=title,
            artist=str(user.get("name") or user.get("handle") or "Unknown artist"),
            duration=self._integer(item.get("duration")),
            quality="MP3",
            source=self.source,
            stream_url=stream_url,
            download_url=download_url,
            score=round(score, 1),
            thumbnail=artwork.get("480x480") or artwork.get("1000x1000") or artwork.get("150x150"),
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
