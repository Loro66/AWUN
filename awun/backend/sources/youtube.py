import re
from typing import Any

import aiohttp

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


def _iso_duration(value: str) -> int:
    match = re.fullmatch(r"P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value or "")
    if not match:
        return 0
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


class YouTubeAdapter(BaseAdapter):
    source = "youtube"
    _SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
    _VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"

    def __init__(self, api_key: str, timeout: float = 12.0) -> None:
        self._api_key = api_key
        self._timeout = aiohttp.ClientTimeout(total=timeout)

    async def search(self, query: str, limit: int) -> list[Track]:
        try:
            async with aiohttp.ClientSession(timeout=self._timeout) as session:
                async with session.get(
                    self._SEARCH_URL,
                    params={
                        "part": "snippet",
                        "q": query,
                        "type": "video",
                        "maxResults": min(limit, 50),
                        "videoEmbeddable": "true",
                        "videoSyndicated": "true",
                        "safeSearch": "moderate",
                        "key": self._api_key,
                    },
                ) as response:
                    payload = await response.json(content_type=None)
                    if response.status != 200:
                        raise AdapterError(self._api_error(payload, response.status))

                items = payload.get("items") or []
                ids = [str(item.get("id", {}).get("videoId") or "") for item in items]
                ids = [video_id for video_id in ids if video_id]
                details: dict[str, dict[str, Any]] = {}
                if ids:
                    async with session.get(
                        self._VIDEOS_URL,
                        params={
                            "part": "contentDetails,status",
                            "id": ",".join(ids),
                            "key": self._api_key,
                        },
                    ) as response:
                        detail_payload = await response.json(content_type=None)
                        if response.status == 200:
                            details = {str(item.get("id")): item for item in detail_payload.get("items") or []}
        except AdapterError:
            raise
        except (aiohttp.ClientError, TimeoutError) as exc:
            raise AdapterError(f"YouTube API request failed ({type(exc).__name__})") from exc

        tracks: list[Track] = []
        for item in items:
            video_id = str(item.get("id", {}).get("videoId") or "")
            if not video_id:
                continue
            detail = details.get(video_id) or {}
            if detail.get("status", {}).get("embeddable") is False:
                continue
            snippet = item.get("snippet") or {}
            thumbnails = snippet.get("thumbnails") or {}
            thumbnail = next(
                (thumbnails.get(size, {}).get("url") for size in ("maxres", "high", "medium", "default") if thumbnails.get(size)),
                None,
            )
            tracks.append(
                Track(
                    id=f"yt_{video_id}",
                    title=snippet.get("title") or "Unknown title",
                    artist=snippet.get("channelTitle") or "YouTube",
                    duration=_iso_duration(detail.get("contentDetails", {}).get("duration") or ""),
                    quality="YT",
                    source=self.source,
                    stream_url=f"https://www.youtube.com/watch?v={video_id}",
                    download_url=None,
                    score=88.0,
                    thumbnail=thumbnail,
                )
            )
        return tracks[:limit]

    @staticmethod
    def _api_error(payload: dict[str, Any], status: int) -> str:
        message = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
        return f"YouTube API returned HTTP {status}: {message or 'unknown error'}"
