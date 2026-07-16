import asyncio
import hashlib
import re
from difflib import SequenceMatcher
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote

import aiohttp

from backend.core.models import Track
from backend.core.regions import RegionProfile
from backend.sources.base import AdapterError, BaseAdapter


_AUDIO_SUFFIXES = {".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav"}


def _text(value: Any, fallback: str = "") -> str:
    if isinstance(value, list):
        value = next((item for item in value if item), fallback)
    return " ".join(str(value or fallback).split()).strip()


def _duration(value: Any) -> int:
    if isinstance(value, str) and ":" in value:
        try:
            parts = [float(part) for part in value.split(":")]
            seconds = 0.0
            for part in parts:
                seconds = seconds * 60 + part
            return max(0, round(seconds))
        except ValueError:
            return 0
    try:
        return max(0, round(float(value or 0)))
    except (TypeError, ValueError):
        return 0


class InternetArchiveAdapter(BaseAdapter):
    """Search public Internet Archive audio and expose its real media files."""

    source = "internet_archive"
    search_url = "https://archive.org/advancedsearch.php"
    metadata_url = "https://archive.org/metadata"
    download_url = "https://archive.org/download"

    def __init__(self, timeout: float = 12.0, max_items: int = 8) -> None:
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.max_items = max(1, min(max_items, 20))
        self._session: aiohttp.ClientSession | None = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=self.timeout,
                headers={"Accept": "application/json", "User-Agent": "AWUN/1.5 (+https://github.com/Loro66/AWUN)"},
            )
        return self._session

    async def search(
        self,
        query: str,
        limit: int,
        *,
        region: RegionProfile | None = None,
    ) -> list[Track]:
        escaped = re.sub(r"([+\-&|!(){}\[\]^\"~*?:\\/])", r"\\\1", query)
        params: list[tuple[str, str]] = [
            ("q", f"mediatype:audio AND ({escaped}) AND -access-restricted-item:true"),
            ("fl[]", "identifier"),
            ("fl[]", "title"),
            ("fl[]", "creator"),
            ("fl[]", "downloads"),
            ("rows", str(min(max(limit, 4), self.max_items))),
            ("page", "1"),
            ("output", "json"),
            ("sort[]", "downloads desc"),
        ]
        try:
            async with (await self._get_session()).get(self.search_url, params=params) as response:
                payload = await response.json(content_type=None)
                if response.status != 200:
                    raise AdapterError(f"Internet Archive returned HTTP {response.status}")
        except AdapterError:
            raise
        except (aiohttp.ClientError, TimeoutError, ValueError) as exc:
            raise AdapterError(f"Internet Archive search failed ({type(exc).__name__})") from exc

        docs = payload.get("response", {}).get("docs", []) if isinstance(payload, dict) else []
        identifiers = [
            str(item.get("identifier"))
            for item in docs
            if isinstance(item, dict) and item.get("identifier")
        ][: self.max_items]
        metadata_results = await asyncio.gather(
            *(self._metadata(identifier) for identifier in identifiers),
            return_exceptions=True,
        )
        tracks: list[Track] = []
        for payload in metadata_results:
            if isinstance(payload, dict):
                tracks.extend(self.tracks_from_metadata(payload, query, max_files=2))
        tracks.sort(key=lambda track: (-track.score, track.title.casefold()))
        return tracks[:limit]

    async def _metadata(self, identifier: str) -> dict[str, Any]:
        async with (await self._get_session()).get(
            f"{self.metadata_url}/{quote(identifier, safe='')}"
        ) as response:
            payload = await response.json(content_type=None)
            return payload if response.status == 200 and isinstance(payload, dict) else {}

    @classmethod
    def tracks_from_metadata(
        cls,
        payload: dict[str, Any],
        query: str,
        max_files: int = 2,
    ) -> list[Track]:
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        identifier = _text(metadata.get("identifier"))
        if not identifier or str(metadata.get("access-restricted-item", "")).lower() == "true":
            return []
        item_title = _text(metadata.get("title"), "Internet Archive audio")
        artist = _text(metadata.get("creator"), "Internet Archive")
        query_key = query.casefold()
        candidates: list[tuple[float, dict[str, Any]]] = []
        for file in payload.get("files") or []:
            if not isinstance(file, dict) or str(file.get("private", "")).lower() == "true":
                continue
            name = _text(file.get("name"))
            suffix = PurePosixPath(name).suffix.lower()
            if not name or suffix not in _AUDIO_SUFFIXES:
                continue
            label = _text(file.get("title"), PurePosixPath(name).stem)
            similarity = SequenceMatcher(None, query_key, f"{artist} {label} {item_title}".casefold()).ratio()
            original_bonus = 0.08 if file.get("source") == "original" else 0.0
            lossless_bonus = 0.04 if suffix in {".flac", ".wav"} else 0.0
            candidates.append((similarity + original_bonus + lossless_bonus, file))

        tracks: list[Track] = []
        for relevance, file in sorted(candidates, key=lambda item: item[0], reverse=True)[:max_files]:
            name = _text(file.get("name"))
            title = _text(file.get("title"), PurePosixPath(name).stem or item_title)
            suffix = PurePosixPath(name).suffix.lower().lstrip(".")
            media_url = f"{cls.download_url}/{quote(identifier, safe='')}/{quote(name, safe='/')}"
            stable = hashlib.sha1(f"{identifier}/{name}".encode()).hexdigest()[:16]
            tracks.append(
                Track(
                    id=f"ia_{stable}",
                    title=title,
                    artist=artist,
                    duration=_duration(file.get("length") or metadata.get("runtime")),
                    quality=suffix.upper() or "AUDIO",
                    source="internet_archive",
                    stream_url=media_url,
                    download_url=media_url,
                    score=min(91.0, 76.0 + relevance * 12),
                    thumbnail=f"https://archive.org/services/img/{quote(identifier, safe='')}",
                    request_headers={"Referer": f"https://archive.org/details/{quote(identifier, safe='')}"},
                )
            )
        return tracks

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
