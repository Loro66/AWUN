import asyncio
import hashlib
from typing import Any

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from backend.core.models import Track
from backend.sources.base import AdapterError, BaseAdapter
from backend.sources.youtube import _quality, _request_headers, _safe_int


class SoundCloudAdapter(BaseAdapter):
    source = "soundcloud"

    def __init__(self, socket_timeout: float = 12.0) -> None:
        self._options = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "format": "bestaudio/best",
            "socket_timeout": socket_timeout,
            "noplaylist": True,
            "extract_flat": False,
        }

    async def search(self, query: str, limit: int) -> list[Track]:
        try:
            return await asyncio.to_thread(self._search_sync, query, limit)
        except DownloadError as exc:
            raise AdapterError(f"SoundCloud search failed: {exc}") from exc
        except Exception as exc:
            raise AdapterError(f"SoundCloud adapter error: {exc}") from exc

    def _search_sync(self, query: str, limit: int) -> list[Track]:
        with YoutubeDL(self._options) as ydl:
            payload = ydl.extract_info(f"scsearch{limit}:{query}", download=False)

        tracks: list[Track] = []
        for info in (payload or {}).get("entries") or []:
            if not info:
                continue
            direct_url = info.get("url")
            if not direct_url:
                continue
            raw_id = str(info.get("id") or info.get("webpage_url") or direct_url)
            stable_id = hashlib.sha1(raw_id.encode("utf-8")).hexdigest()[:16]
            quality, score = _quality(info)
            tracks.append(
                Track(
                    id=f"sc_{stable_id}",
                    title=info.get("track") or info.get("title") or "Unknown title",
                    artist=info.get("artist") or info.get("uploader") or "Unknown artist",
                    duration=_safe_int(info.get("duration")),
                    quality=quality,
                    source=self.source,
                    stream_url=direct_url,
                    download_url=direct_url,
                    score=score,
                    thumbnail=info.get("thumbnail"),
                    request_headers=_request_headers(info),
                )
            )
        return tracks[:limit]
