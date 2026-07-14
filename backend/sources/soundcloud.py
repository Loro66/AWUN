import asyncio
import base64
import hashlib
from time import monotonic
from typing import Any
from urllib.parse import urlparse

import aiohttp
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from backend.core.models import Track
from backend.sources.base import AdapterError, BaseAdapter
from backend.sources.youtube import _quality, _request_headers, _safe_int


def _is_progressive_audio(url: str, protocol: str | None = None) -> bool:
    """Return true only for a single downloadable HTTP audio resource."""
    normalized_protocol = str(protocol or "").lower()
    if "m3u8" in normalized_protocol or "dash" in normalized_protocol:
        return False
    path = urlparse(url).path.lower()
    return not path.endswith((".m3u8", ".mpd")) and "playlist.m3u8" not in path


class SoundCloudAdapter(BaseAdapter):
    source = "soundcloud"
    _TOKEN_URL = "https://secure.soundcloud.com/oauth/token"
    _TRACKS_URL = "https://api.soundcloud.com/tracks"

    def __init__(
        self,
        timeout: float = 12.0,
        client_id: str | None = None,
        client_secret: str | None = None,
    ) -> None:
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._client_id = client_id
        self._client_secret = client_secret
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._legacy_options = {
            "quiet": True,
            "no_warnings": True,
            "ignoreerrors": True,
            "skip_download": True,
            "format": "bestaudio/best",
            "socket_timeout": timeout,
            "noplaylist": True,
            "extract_flat": False,
        }

    async def search(self, query: str, limit: int) -> list[Track]:
        if self._client_id and self._client_secret:
            return await self._search_api(query, limit)
        try:
            # Unauthenticated SoundCloud search can abort when a later result is
            # DRM-only. A small window is much more reliable; official OAuth
            # credentials automatically unlock the full requested limit above.
            return await asyncio.to_thread(self._search_legacy, query, min(limit, 5))
        except DownloadError as exc:
            raise AdapterError("SoundCloud needs API credentials for this query") from exc
        except Exception as exc:
            raise AdapterError(f"SoundCloud adapter error: {exc}") from exc

    async def _search_api(self, query: str, limit: int) -> list[Track]:
        token = await self._access_token()
        headers = {"Authorization": f"OAuth {token}", "Accept": "application/json"}
        try:
            async with aiohttp.ClientSession(timeout=self._timeout) as session:
                async with session.get(
                    self._TRACKS_URL,
                    headers=headers,
                    params={
                        "q": query,
                        "access": "playable",
                        "limit": min(limit, 200),
                        "linked_partitioning": "true",
                    },
                ) as response:
                    payload = await response.json(content_type=None)
                    if response.status != 200:
                        raise AdapterError(f"SoundCloud API returned HTTP {response.status}")
        except AdapterError:
            raise
        except (aiohttp.ClientError, TimeoutError) as exc:
            raise AdapterError(f"SoundCloud request failed ({type(exc).__name__})") from exc

        items = payload.get("collection", payload if isinstance(payload, list) else [])
        candidates = []
        for item in items:
            if item.get("access") not in {None, "playable"}:
                continue
            track_id = str(item.get("id") or "")
            stream_url = item.get("stream_url") or (f"{self._TRACKS_URL}/{track_id}/stream" if track_id else None)
            if not track_id or not stream_url:
                continue
            candidates.append((item, track_id, stream_url))

        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            resolved = await asyncio.gather(
                *(self._resolve_stream(session, stream_url, headers) for _, _, stream_url in candidates[:limit]),
                return_exceptions=True,
            )
            downloads = await asyncio.gather(
                *(
                    self._authorized_url(session, str(item["download_url"]), headers)
                    if item.get("downloadable") and item.get("download_url")
                    else asyncio.sleep(0, result=None)
                    for item, _, _ in candidates[:limit]
                ),
                return_exceptions=True,
            )

        tracks: list[Track] = []
        for (item, track_id, _), direct_url, download_url in zip(
            candidates[:limit], resolved, downloads, strict=True
        ):
            if isinstance(direct_url, Exception) or not direct_url:
                continue
            official_download = (
                download_url
                if isinstance(download_url, str) and _is_progressive_audio(download_url)
                else None
            )
            artist = (item.get("user") or {}).get("username") or item.get("publisher_metadata", {}).get("artist") or "Unknown artist"
            tracks.append(
                Track(
                    id=f"sc_{track_id}",
                    title=item.get("title") or "Unknown title",
                    artist=artist,
                    duration=max(0, int((item.get("duration") or 0) / 1000)),
                    quality="128",
                    source=self.source,
                    stream_url=direct_url,
                    download_url=official_download,
                    score=76.0,
                    thumbnail=item.get("artwork_url") or (item.get("user") or {}).get("avatar_url"),
                )
            )
        return tracks[:limit]

    async def _resolve_stream(
        self,
        session: aiohttp.ClientSession,
        stream_url: str,
        headers: dict[str, str],
    ) -> str | None:
        async with session.get(stream_url, headers=headers, allow_redirects=False) as response:
            if response.status in {301, 302, 303, 307, 308}:
                return response.headers.get("Location")
            if response.status != 200:
                return None
            if response.headers.get("content-type", "").startswith("audio/"):
                return str(response.url)
            payload = await response.json(content_type=None)
        if not isinstance(payload, dict):
            return None
        for key in ("http_mp3_128_url", "http_aac_160_url", "url"):
            value = payload.get(key)
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return await self._authorized_url(session, value, headers)
        streams = payload.get("collection") or payload.get("transcodings") or []
        if isinstance(streams, list):
            progressive = next(
                (
                    item.get("url")
                    for item in streams
                    if isinstance(item, dict)
                    and item.get("format", {}).get("protocol") == "progressive"
                    and isinstance(item.get("url"), str)
                ),
                None,
            )
            if progressive:
                return await self._authorized_url(session, progressive, headers)
        return None

    async def _authorized_url(
        self,
        session: aiohttp.ClientSession,
        value: str,
        headers: dict[str, str],
    ) -> str | None:
        if "api.soundcloud.com" not in value:
            return value
        async with session.get(value, headers=headers, allow_redirects=False) as response:
            if response.status in {301, 302, 303, 307, 308}:
                return response.headers.get("Location")
            if response.status != 200:
                return None
            payload = await response.json(content_type=None)
        direct = payload.get("url") if isinstance(payload, dict) else None
        return direct if isinstance(direct, str) and direct.startswith(("http://", "https://")) else None

    async def _access_token(self) -> str:
        if self._token and monotonic() < self._token_expires_at:
            return self._token
        credentials = base64.b64encode(f"{self._client_id}:{self._client_secret}".encode()).decode()
        try:
            async with aiohttp.ClientSession(timeout=self._timeout) as session:
                async with session.post(
                    self._TOKEN_URL,
                    headers={
                        "Authorization": f"Basic {credentials}",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                    },
                    data={"grant_type": "client_credentials"},
                ) as response:
                    payload = await response.json(content_type=None)
                    if response.status != 200 or not payload.get("access_token"):
                        raise AdapterError(f"SoundCloud OAuth returned HTTP {response.status}")
        except AdapterError:
            raise
        except (aiohttp.ClientError, TimeoutError) as exc:
            raise AdapterError(f"SoundCloud OAuth failed ({type(exc).__name__})") from exc
        self._token = str(payload["access_token"])
        self._token_expires_at = monotonic() + max(60, int(payload.get("expires_in") or 3600) - 60)
        return self._token

    def _search_legacy(self, query: str, limit: int) -> list[Track]:
        with YoutubeDL(self._legacy_options) as ydl:
            payload = ydl.extract_info(f"scsearch{limit}:{query}", download=False)

        tracks: list[Track] = []
        for info in (payload or {}).get("entries") or []:
            if not info or not info.get("url"):
                continue
            raw_id = str(info.get("id") or info.get("webpage_url") or info["url"])
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
                    stream_url=info["url"],
                    # Unauthenticated search does not prove that the uploader
                    # enabled downloads. Keep it playable, but do not expose a
                    # misleading HLS/token "download" button.
                    download_url=None,
                    score=score,
                    thumbnail=info.get("thumbnail"),
                    request_headers=_request_headers(info),
                )
            )
        return tracks[:limit]
