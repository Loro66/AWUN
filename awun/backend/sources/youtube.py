import asyncio
import re
from typing import Any

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from backend.core.models import Track
from backend.sources.base import AdapterError, BaseAdapter


def _safe_int(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def _quality(info: dict[str, Any]) -> tuple[str, float]:
    abr = info.get("abr") or info.get("tbr") or 0
    try:
        bitrate = int(float(abr))
    except (TypeError, ValueError):
        bitrate = 0

    codec = str(info.get("acodec") or "").lower()
    extension = str(info.get("audio_ext") or info.get("ext") or "").lower()
    if extension == "flac" or "flac" in codec:
        return "flac", 98.0
    if bitrate >= 300:
        return "320", 92.0
    if bitrate >= 180:
        return "192", 82.0
    return "128", 70.0


def _request_headers(info: dict[str, Any]) -> dict[str, str]:
    allowed = {"user-agent", "referer", "origin", "accept", "accept-language"}
    return {
        str(key): str(value)
        for key, value in (info.get("http_headers") or {}).items()
        if str(key).lower() in allowed
    }


class YouTubeAdapter(BaseAdapter):
    source = "youtube"

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
            raise AdapterError(f"YouTube search failed: {exc}") from exc
        except Exception as exc:
            raise AdapterError(f"YouTube adapter error: {exc}") from exc

    def _search_sync(self, query: str, limit: int) -> list[Track]:
        with YoutubeDL(self._options) as ydl:
            payload = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)

        tracks: list[Track] = []
        for info in (payload or {}).get("entries") or []:
            if not info:
                continue
            direct_url = info.get("url")
            video_id = str(info.get("id") or "")
            if not direct_url or not video_id:
                continue
            quality, score = _quality(info)
            artist = info.get("artist") or info.get("uploader") or info.get("channel") or "Unknown artist"
            title = info.get("track") or info.get("title") or "Unknown title"
            tracks.append(
                Track(
                    id=f"yt_{re.sub(r'[^A-Za-z0-9_-]', '', video_id)}",
                    title=title,
                    artist=artist,
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
