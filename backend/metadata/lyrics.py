from __future__ import annotations

from collections.abc import Iterable
from difflib import SequenceMatcher
import re
import unicodedata
from typing import Any

import aiohttp

from backend.core.config import Settings
from backend.core.models import LyricLine, TrackAnnotation, TrackDetailsResponse


_TIMESTAMP = re.compile(r"\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]")


def parse_synced_lyrics(value: str | None) -> list[LyricLine]:
    """Convert LRC into ordered lines while retaining every timestamp."""

    rows: list[tuple[float, str]] = []
    for raw_line in (value or "").splitlines():
        matches = list(_TIMESTAMP.finditer(raw_line))
        if not matches:
            continue
        text = _TIMESTAMP.sub("", raw_line).strip()
        if not text:
            continue
        for match in matches:
            seconds = int(match.group(1)) * 60 + float(match.group(2))
            rows.append((round(seconds, 3), text))
    rows.sort(key=lambda row: row[0])
    return [LyricLine(index=index, time=seconds, text=text) for index, (seconds, text) in enumerate(rows)]


def parse_plain_lyrics(value: str | None) -> list[LyricLine]:
    lines = [line.strip() for line in (value or "").splitlines() if line.strip()]
    return [LyricLine(index=index, text=text) for index, text in enumerate(lines)]


def _normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).casefold()
    return " ".join(re.sub(r"[^\w]+", " ", value, flags=re.UNICODE).split())


def _dom_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(_dom_text(item) for item in value)
    if not isinstance(value, dict):
        return ""
    tag = str(value.get("tag") or "").lower()
    content = _dom_text(value.get("children") or value.get("child") or [])
    if tag in {"br", "p", "li", "blockquote"}:
        return f"{content}\n"
    return content


def _annotation_text(annotation: dict[str, Any]) -> str:
    body = annotation.get("body") or {}
    value = _dom_text(body.get("dom") or body.get("plain") or body)
    return re.sub(r"\n{3,}", "\n\n", value).strip()[:1200]


def _line_match(fragment: str, lines: Iterable[LyricLine]) -> LyricLine | None:
    fragment_lines = [_normalized(item) for item in fragment.splitlines() if _normalized(item)]
    if not fragment_lines:
        return None
    best: tuple[float, LyricLine] | None = None
    for line in lines:
        candidate = _normalized(line.text)
        if not candidate:
            continue
        for fragment_line in fragment_lines:
            if candidate in fragment_line or fragment_line in candidate:
                score = 1.0
            else:
                score = SequenceMatcher(None, candidate, fragment_line).ratio()
            if best is None or score > best[0]:
                best = (score, line)
    return best[1] if best and best[0] >= 0.58 else None


def attach_genius_referents(lines: list[LyricLine], referents: list[dict[str, Any]]) -> None:
    """Attach official Genius annotation bodies to the closest lyric line."""

    for referent in referents:
        line = _line_match(str(referent.get("fragment") or ""), lines)
        if line is None:
            continue
        for raw in (referent.get("annotations") or [])[:2]:
            text = _annotation_text(raw)
            if not text:
                continue
            authors = raw.get("authors") or []
            user = (authors[0].get("user") or {}) if authors else {}
            line.annotations.append(
                TrackAnnotation(
                    id=f"genius_{raw.get('id') or len(line.annotations)}",
                    text=text,
                    author=user.get("name") or user.get("login"),
                    url=raw.get("url") or referent.get("url"),
                    votes=int(raw.get("votes_total") or 0),
                )
            )


class TrackDetailsService:
    def __init__(self, settings: Settings) -> None:
        self.enabled = settings.lyrics_enabled
        self.lrclib_base_url = settings.lrclib_base_url.rstrip("/")
        self.genius_access_token = settings.genius_access_token
        self.timeout = aiohttp.ClientTimeout(total=settings.track_details_timeout_seconds)

    async def close(self) -> None:
        return None

    async def get(self, artist: str, title: str, duration: int = 0) -> TrackDetailsResponse:
        result = TrackDetailsResponse(
            artist=artist,
            title=title,
            genius_enabled=bool(self.genius_access_token),
        )
        if not self.enabled:
            result.message = "Track stories are disabled"
            return result

        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            lyrics = await self._lyrics(session, artist, title, duration)
            if lyrics:
                result.lyrics_source = "lrclib"
                result.synced = bool(lyrics.get("syncedLyrics"))
                result.lines = parse_synced_lyrics(lyrics.get("syncedLyrics"))
                if not result.lines:
                    result.lines = parse_plain_lyrics(lyrics.get("plainLyrics"))

            if self.genius_access_token:
                genius = await self._genius(session, artist, title)
                if genius:
                    result.genius_url = genius.get("url")
                    attach_genius_referents(result.lines, genius.get("referents") or [])

        if not result.lines:
            result.message = "Lyrics are not available for this recording"
        elif not self.genius_access_token:
            result.message = "Add AWUN_GENIUS_ACCESS_TOKEN to include official Genius annotations"
        return result

    async def _lyrics(
        self,
        session: aiohttp.ClientSession,
        artist: str,
        title: str,
        duration: int,
    ) -> dict[str, Any] | None:
        params: dict[str, str | int] = {"artist_name": artist, "track_name": title}
        if duration > 0:
            params["duration"] = round(duration)
        headers = {
            "Accept": "application/json",
            "User-Agent": "AWUN/1.6 (+https://github.com/Loro66/AWUN)",
            "Lrclib-Client": "AWUN/1.6",
        }
        try:
            async with session.get(f"{self.lrclib_base_url}/api/get", params=params, headers=headers) as response:
                if response.status == 404:
                    return None
                response.raise_for_status()
                payload = await response.json(content_type=None)
                return payload if isinstance(payload, dict) else None
        except (aiohttp.ClientError, TimeoutError, ValueError):
            return None

    async def _genius(
        self,
        session: aiohttp.ClientSession,
        artist: str,
        title: str,
    ) -> dict[str, Any] | None:
        headers = {"Authorization": f"Bearer {self.genius_access_token}", "Accept": "application/json"}
        try:
            async with session.get(
                "https://api.genius.com/search",
                params={"q": f"{artist} {title}"},
                headers=headers,
            ) as response:
                response.raise_for_status()
                hits = ((await response.json(content_type=None)).get("response") or {}).get("hits") or []
            song = next((hit.get("result") for hit in hits if hit.get("type") == "song"), None)
            if not song or not song.get("id"):
                return None
            async with session.get(
                "https://api.genius.com/referents",
                params={"song_id": song["id"], "text_format": "dom", "per_page": 30},
                headers=headers,
            ) as response:
                response.raise_for_status()
                referents = ((await response.json(content_type=None)).get("response") or {}).get("referents") or []
            return {"url": song.get("url"), "referents": referents}
        except (aiohttp.ClientError, TimeoutError, ValueError, AttributeError):
            return None
