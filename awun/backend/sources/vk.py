from typing import Any

import aiohttp

from backend.core.models import Track
from backend.sources.base import AdapterError, BaseAdapter


class VKAdapter(BaseAdapter):
    source = "vk"
    _API_URL = "https://api.vk.com/method/audio.search"

    def __init__(self, access_token: str, api_version: str = "5.199", timeout: float = 12.0) -> None:
        self._access_token = access_token
        self._api_version = api_version
        self._timeout = aiohttp.ClientTimeout(total=timeout)

    async def search(self, query: str, limit: int) -> list[Track]:
        params = {
            "q": query,
            "count": limit,
            "auto_complete": 1,
            "sort": 2,
            "access_token": self._access_token,
            "v": self._api_version,
        }
        try:
            async with aiohttp.ClientSession(timeout=self._timeout) as session:
                async with session.get(self._API_URL, params=params) as response:
                    response.raise_for_status()
                    payload: dict[str, Any] = await response.json(content_type=None)
        except aiohttp.ClientResponseError as exc:
            # Do not include the request URL: its query string contains the token.
            raise AdapterError(f"VK returned HTTP {exc.status}") from exc
        except (aiohttp.ClientError, TimeoutError) as exc:
            raise AdapterError(f"VK request failed ({type(exc).__name__})") from exc

        if error := payload.get("error"):
            message = error.get("error_msg", "Unknown VK API error")
            raise AdapterError(f"VK API error: {message}")

        items = payload.get("response", {}).get("items", [])
        tracks: list[Track] = []
        for item in items:
            direct_url = item.get("url")
            if not direct_url:
                continue
            audio_id = f"{item.get('owner_id', 0)}_{item.get('id', 0)}"
            tracks.append(
                Track(
                    id=f"vk_{audio_id}",
                    title=item.get("title") or "Unknown title",
                    artist=item.get("artist") or "Unknown artist",
                    duration=max(0, int(item.get("duration") or 0)),
                    quality="320" if item.get("is_hq") else "192",
                    source=self.source,
                    stream_url=direct_url,
                    download_url=direct_url,
                    score=90.0 if item.get("is_hq") else 80.0,
                    thumbnail=self._cover(item),
                )
            )
        return tracks[:limit]

    @staticmethod
    def _cover(item: dict[str, Any]) -> str | None:
        album = item.get("album") or {}
        thumb = album.get("thumb") or {}
        for size in ("photo_1200", "photo_600", "photo_300", "photo_270", "photo_135"):
            if thumb.get(size):
                return thumb[size]
        return None
