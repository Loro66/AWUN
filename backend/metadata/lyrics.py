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
_SPACE = re.compile(r"\s+")
_BRACKETED_NOISE = re.compile(
    r"\s*[\[(](?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visuali[sz]er|clip|hd|4k)[^\])]*[\])]",
    re.IGNORECASE,
)
_VERSION_MARKER = re.compile(
    r"\b(?:cover|covered|remix|rework|edit|version|style|live|karaoke|nightcore|instrumental|sped\s+up|slowed)\b",
    re.IGNORECASE,
)


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


def canonical_track_title(title: str) -> str:
    """Reduce catalog-hostile video titles to the underlying song name."""

    value = _SPACE.sub(" ", (title or "").strip())
    value = _BRACKETED_NOISE.sub("", value).strip(" -–—|:")
    for separator in (" - ", " – ", " — ", " | "):
        if separator not in value:
            continue
        head, tail = value.split(separator, 1)
        if head.strip() and _VERSION_MARKER.search(tail):
            value = head.strip()
            break
    return _SPACE.sub(" ", value).strip(" -–—|:") or title.strip()


def _title_similarity(expected: str, actual: str) -> float:
    left, right = _normalized(expected), _normalized(actual)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def select_lyric_candidate(
    candidates: Iterable[dict[str, Any]],
    title: str,
    duration: int = 0,
) -> dict[str, Any] | None:
    """Select a conservative LRCLIB fallback instead of taking result zero."""

    target = canonical_track_title(title)
    best: tuple[float, float, dict[str, Any]] | None = None
    for candidate in candidates:
        candidate_title = str(candidate.get("trackName") or "")
        title_score = _title_similarity(target, canonical_track_title(candidate_title))
        if title_score < 0.68:
            continue
        candidate_duration = candidate.get("duration") or 0
        try:
            delta = abs(float(candidate_duration) - float(duration))
        except (TypeError, ValueError):
            delta = 999.0
        duration_score = max(0.0, 1.0 - delta / max(float(duration or 240), 90.0)) if duration else 0.5
        score = title_score * 0.88 + duration_score * 0.12
        ranked = (score, title_score, candidate)
        if best is None or ranked[:2] > best[:2]:
            best = ranked
    return best[2] if best else None


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
            genius_status="not_found" if self.genius_access_token else "disabled",
        )
        if not self.enabled:
            result.message = "Track stories are disabled"
            return result

        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            lyrics = await self._lyrics(session, artist, title, duration)
            if lyrics:
                result.lyrics_source = "lrclib"
                result.match_type = lyrics.get("_awun_match_type", "exact")
                result.matched_artist = lyrics.get("artistName") or artist
                result.matched_title = lyrics.get("trackName") or title
                result.synced = bool(lyrics.get("syncedLyrics"))
                result.lines = parse_synced_lyrics(lyrics.get("syncedLyrics"))
                if not result.lines:
                    result.lines = parse_plain_lyrics(lyrics.get("plainLyrics"))

            if self.genius_access_token:
                genius = await self._genius(session, artist, title)
                result.genius_status = genius.get("status", "error")
                if result.genius_status == "matched":
                    result.genius_url = genius.get("url")
                    attach_genius_referents(result.lines, genius.get("referents") or [])
                    result.annotation_count = sum(len(line.annotations) for line in result.lines)

        if not result.lines:
            if result.genius_status == "matched":
                result.message = "Genius matched the song, but no lyrics provider returned text for this recording"
            else:
                result.message = "Lyrics are not available for this recording"
        elif result.match_type == "canonical":
            match = " — ".join(part for part in (result.matched_artist, result.matched_title) if part)
            result.message = f"Showing the closest canonical song match: {match}"
        elif result.genius_status == "matched" and result.annotation_count == 0:
            result.message = "Genius matched this song but currently exposes no public line annotations for it"
        elif result.genius_status == "not_found":
            result.message = "Lyrics found; Genius did not return a confident song match"
        elif result.genius_status == "error":
            result.message = "Lyrics found; Genius is temporarily unavailable"
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
            "User-Agent": "AWUN/1.6.2 (+https://github.com/Loro66/AWUN)",
            "Lrclib-Client": "AWUN/1.6.2",
        }
        try:
            async with session.get(f"{self.lrclib_base_url}/api/get", params=params, headers=headers) as response:
                if response.status != 404:
                    response.raise_for_status()
                    payload = await response.json(content_type=None)
                    if isinstance(payload, dict):
                        payload["_awun_match_type"] = "exact"
                        return payload

            canonical = canonical_track_title(title)
            async with session.get(
                f"{self.lrclib_base_url}/api/search",
                params={"track_name": canonical},
                headers=headers,
            ) as response:
                response.raise_for_status()
                payload = await response.json(content_type=None)
            candidate = select_lyric_candidate(payload if isinstance(payload, list) else [], canonical, duration)
            if candidate:
                candidate = dict(candidate)
                candidate["_awun_match_type"] = "canonical"
            return candidate
        except (aiohttp.ClientError, TimeoutError, ValueError):
            return None

    async def _genius(
        self,
        session: aiohttp.ClientSession,
        artist: str,
        title: str,
    ) -> dict[str, Any] | None:
        headers = {"Authorization": f"Bearer {self.genius_access_token}", "Accept": "application/json"}
        canonical = canonical_track_title(title)
        queries = [canonical]
        if canonical == title.strip() and artist.strip():
            queries.insert(0, f"{artist} {canonical}")
        try:
            song: dict[str, Any] | None = None
            best_score = 0.0
            for query in dict.fromkeys(queries):
                async with session.get(
                    "https://api.genius.com/search",
                    params={"q": query},
                    headers=headers,
                ) as response:
                    response.raise_for_status()
                    hits = ((await response.json(content_type=None)).get("response") or {}).get("hits") or []
                for hit in hits:
                    candidate = hit.get("result") if hit.get("type") == "song" else None
                    if not candidate:
                        continue
                    score = max(
                        _title_similarity(canonical, str(candidate.get("title") or "")),
                        _title_similarity(canonical, str(candidate.get("title_with_featured") or "")),
                    )
                    if score > best_score:
                        song, best_score = candidate, score
                if best_score >= 0.9:
                    break
            if not song or not song.get("id"):
                return {"status": "not_found"}
            if best_score < 0.68:
                return {"status": "not_found"}
            async with session.get(
                "https://api.genius.com/referents",
                params={"song_id": song["id"], "text_format": "dom", "per_page": 30},
                headers=headers,
            ) as response:
                response.raise_for_status()
                referents = ((await response.json(content_type=None)).get("response") or {}).get("referents") or []
            return {
                "status": "matched",
                "url": song.get("url"),
                "title": song.get("title"),
                "artist": (song.get("primary_artist") or {}).get("name"),
                "referents": referents,
            }
        except (aiohttp.ClientError, TimeoutError, ValueError, AttributeError):
            return {"status": "error"}
