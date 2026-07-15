import asyncio
import re
from typing import Any

import aiohttp
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from backend.core.models import Track
from backend.core.regions import RegionProfile
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

    def __init__(self, api_key: str | None = None, timeout: float = 12.0) -> None:
        self._api_key = api_key
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._flat_options = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": "in_playlist",
            "socket_timeout": timeout,
            "noplaylist": True,
        }

    async def search(
        self,
        query: str,
        limit: int,
        *,
        region: RegionProfile | None = None,
    ) -> list[Track]:
        api_error: AdapterError | None = None
        if self._api_key:
            try:
                return await self._search_api(query, limit, region=region)
            except AdapterError as exc:
                api_error = exc
        try:
            return await asyncio.to_thread(self._search_flat, query, limit)
        except DownloadError as exc:
            detail = f"; Data API: {api_error}" if api_error else ""
            raise AdapterError(f"YouTube search fallback failed{detail}") from exc
        except Exception as exc:
            detail = f"; Data API: {api_error}" if api_error else ""
            raise AdapterError(f"YouTube adapter error: {exc}{detail}") from exc

    async def search_many(
        self,
        queries: list[str],
        limit: int,
        *,
        region: RegionProfile | None = None,
    ) -> list[Track]:
        if not self._api_key:
            return await super().search_many(queries[:2], limit, region=region)
        combined: list[str] = []
        for query in queries[:4]:
            candidate = " | ".join([*combined, query])
            if len(candidate) > 200:
                break
            combined.append(query)
        return await self.search(" | ".join(combined) or queries[0], limit, region=region)

    def _api_params(
        self,
        query: str,
        limit: int,
        region: RegionProfile | None,
    ) -> dict[str, str | int]:
        params: dict[str, str | int] = {
            "part": "snippet",
            "q": query,
            "type": "video",
            "maxResults": min(limit, 50),
            "videoEmbeddable": "true",
            "videoSyndicated": "true",
            "safeSearch": "moderate",
            "key": self._api_key or "",
        }
        if region and region.country:
            params["regionCode"] = region.country
        if region and region.language:
            params["relevanceLanguage"] = region.language
        return params

    async def _search_api(
        self,
        query: str,
        limit: int,
        *,
        region: RegionProfile | None = None,
    ) -> list[Track]:
        try:
            async with aiohttp.ClientSession(timeout=self._timeout) as session:
                async with session.get(
                    self._SEARCH_URL,
                    params=self._api_params(query, limit, region),
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

    def _search_flat(self, query: str, limit: int) -> list[Track]:
        """Search public YouTube metadata without resolving media URLs.

        This is deliberately metadata-only: playback stays in the official
        YouTube iframe player and no protected YouTube media URL is exposed.
        """
        with YoutubeDL(self._flat_options) as ydl:
            payload = ydl.extract_info(f"ytsearch{min(limit, 50)}:{query}", download=False)

        tracks: list[Track] = []
        for info in (payload or {}).get("entries") or []:
            if not info:
                continue
            video_id = str(info.get("id") or "")
            if not re.fullmatch(r"[A-Za-z0-9_-]{6,20}", video_id):
                continue
            thumbnails = info.get("thumbnails") or []
            thumbnail = info.get("thumbnail")
            if not thumbnail and thumbnails:
                thumbnail = thumbnails[-1].get("url")
            tracks.append(
                Track(
                    id=f"yt_{video_id}",
                    title=info.get("title") or "Unknown title",
                    artist=info.get("channel") or info.get("uploader") or "YouTube",
                    duration=_safe_int(info.get("duration")),
                    quality="YT",
                    source=self.source,
                    stream_url=f"https://www.youtube.com/watch?v={video_id}",
                    download_url=None,
                    score=84.0,
                    thumbnail=thumbnail,
                )
            )
        return tracks[:limit]

    @staticmethod
    def _api_error(payload: dict[str, Any], status: int) -> str:
        message = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
        return f"YouTube API returned HTTP {status}: {message or 'unknown error'}"
