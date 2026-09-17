from __future__ import annotations

from collections.abc import Iterable
from difflib import SequenceMatcher
import re
import unicodedata
from typing import Any

import aiohttp

from backend.core.version import APP_VERSION

from backend.core.config import Settings
from backend.core.models import LyricLine, TrackAnnotation, TrackDetailsResponse


_TIMESTAMP = re.compile(r"\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]")
_SPACE = re.compile(r"\s+")
_BRACKETED_NOISE = re.compile(
    r"\s*[\[(](?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visuali[sz]er|clip|hd|4k)[^\])]*[\])]",
    re.IGNORECASE,
)
_VERSION_MARKER = re.compile(
    r"\b(?:acoustic|cover|covered|demo|instrumental|karaoke|live|nightcore|remaster(?:ed)?|remix|rework|"
    r"sped\s+up|slowed(?:\s+down)?|version)\b",
    re.IGNORECASE,
)
_TRAILING_PRESENTATION = re.compile(
    r"\s*(?:[-–—|:]\s*)?(?:official\s+(?:music\s+)?(?:video|audio)|lyrics?|visuali[sz]er|"
    r"audio|video|hd|hq|4k)\s*$",
    re.IGNORECASE,
)
_FEATURED_ARTIST = re.compile(r"\s+\b(?:feat(?:uring)?|ft)\.?\b.*$", re.IGNORECASE)
_LYRIC_SECTION = re.compile(
    r"^\s*[\[(]?(?:bridge|chorus|hook|intro|outro|pre[- ]?chorus|refrain|verse)(?:\s+\d+)?[\])]?:?\s*$",
    re.IGNORECASE,
)
_UNRELIABLE_ARTISTS = {
    "artist",
    "unknown",
    "unknown artist",
    "various artists",
    "youtube",
    "soundcloud",
}


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
    value = _TRAILING_PRESENTATION.sub("", value).strip(" -–—|:")
    return _SPACE.sub(" ", value).strip(" -–—|:") or title.strip()


def canonical_artist_name(artist: str) -> str:
    """Remove featured-artist suffixes while preserving the credited lead artist."""

    value = _FEATURED_ARTIST.sub("", (artist or "").strip())
    return _SPACE.sub(" ", value).strip(" -–—|,:&") or artist.strip()


def _title_similarity(expected: str, actual: str) -> float:
    left, right = _normalized(expected), _normalized(actual)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def _name_similarity(expected: str, actual: str) -> float:
    left, right = _normalized(expected), _normalized(actual)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    left_tokens, right_tokens = set(left.split()), set(right.split())
    overlap = 2 * len(left_tokens & right_tokens) / max(len(left_tokens) + len(right_tokens), 1)
    containment = 0.94 if left in right or right in left else 0.0
    return max(SequenceMatcher(None, left, right).ratio(), overlap, containment)


def _version_markers(value: str) -> frozenset[str]:
    markers = {_normalized(match.group(0)) for match in _VERSION_MARKER.finditer(value or "")}
    aliases = {"covered": "cover", "remastered": "remaster", "slowed down": "slowed"}
    return frozenset(aliases.get(marker, marker) for marker in markers)


def _candidate_artists(candidate: dict[str, Any]) -> list[str]:
    values = [str(candidate.get("artist_names") or "")]
    primary = candidate.get("primary_artist") or {}
    values.append(str(primary.get("name") or ""))
    values.extend(str(item.get("name") or "") for item in (candidate.get("featured_artists") or []))
    return [value for value in values if value.strip()]


def genius_candidate_score(
    candidate: dict[str, Any],
    artist: str,
    title: str,
    rank: int = 0,
) -> float:
    """Score a Genius song conservatively using title, artist and recording type."""

    target_title = canonical_track_title(title)
    candidate_titles = [
        str(candidate.get("title") or ""),
        str(candidate.get("title_with_featured") or ""),
    ]
    title_score = max(
        (_title_similarity(target_title, canonical_track_title(value)) for value in candidate_titles if value),
        default=0.0,
    )
    if title_score < 0.66:
        return 0.0

    expected_versions = _version_markers(title)
    candidate_versions = frozenset().union(*(_version_markers(value) for value in candidate_titles if value))
    if expected_versions != candidate_versions and (expected_versions or candidate_versions):
        return 0.0

    target_artist = canonical_artist_name(artist)
    normalized_artist = _normalized(target_artist)
    reliable_artist = bool(normalized_artist and normalized_artist not in _UNRELIABLE_ARTISTS)
    artist_score = max(
        (_name_similarity(target_artist, value) for value in _candidate_artists(candidate)),
        default=0.0,
    )
    if reliable_artist and artist_score < 0.42:
        return 0.0
    if not reliable_artist:
        artist_score = 0.5

    rank_score = max(0.0, 1.0 - min(max(rank, 0), 9) / 10)
    return round(title_score * 0.64 + artist_score * 0.30 + 0.04 + rank_score * 0.02, 6)


def select_genius_candidate(
    hits: Iterable[dict[str, Any]],
    artist: str,
    title: str,
) -> tuple[dict[str, Any], float] | None:
    """Choose a high-confidence Genius song instead of trusting result order."""

    best: tuple[float, dict[str, Any]] | None = None
    for rank, hit in enumerate(hits):
        candidate = hit.get("result") if hit.get("type") == "song" else None
        if not isinstance(candidate, dict):
            continue
        score = genius_candidate_score(candidate, artist, title, rank)
        if score and (best is None or score > best[0]):
            best = (score, candidate)
    if best is None or best[0] < 0.74:
        return None
    return best[1], best[0]


def select_genius_lyrics_hint(lines: Iterable[LyricLine]) -> str | None:
    """Pick one distinctive lyric line for a bounded Genius content search fallback."""

    best: tuple[float, str] | None = None
    for line in lines:
        text = _SPACE.sub(" ", line.text.strip())
        if _LYRIC_SECTION.match(text) or not 24 <= len(text) <= 140:
            continue
        words = _normalized(text).split()
        if not 5 <= len(words) <= 18:
            continue
        diversity = len(set(words)) / len(words)
        length_score = 1.0 - min(abs(len(words) - 10), 10) / 10
        score = diversity * 0.7 + length_score * 0.3
        if best is None or score > best[0]:
            best = (score, text)
    return best[1] if best else None


def genius_search_queries(artist: str, title: str, lines: Iterable[LyricLine] = ()) -> list[str]:
    canonical_title = canonical_track_title(title)
    canonical_artist = canonical_artist_name(artist)
    hint = select_genius_lyrics_hint(lines)
    candidates = [
        " ".join(part for part in (canonical_artist, canonical_title) if part),
        canonical_title,
        " ".join(part for part in (hint, canonical_artist) if part),
    ]
    queries: list[str] = []
    seen: set[str] = set()
    for query in candidates:
        normalized = _normalized(query)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        queries.append(query)
    return queries[:3]


def select_lyric_candidate(
    candidates: Iterable[dict[str, Any]],
    title: str,
    duration: int = 0,
    artist: str = "",
) -> dict[str, Any] | None:
    """Select a conservative LRCLIB fallback instead of taking result zero."""

    target = canonical_track_title(title)
    best: tuple[float, float, dict[str, Any]] | None = None
    for candidate in candidates:
        candidate_title = str(candidate.get("trackName") or "")
        title_score = _title_similarity(target, canonical_track_title(candidate_title))
        if title_score < 0.68:
            continue
        artist_score = (
            _name_similarity(canonical_artist_name(artist), str(candidate.get("artistName") or ""))
            if artist
            else 0.5
        )
        if artist and artist_score < 0.42:
            continue
        candidate_duration = candidate.get("duration") or 0
        try:
            delta = abs(float(candidate_duration) - float(duration))
        except (TypeError, ValueError):
            delta = 999.0
        duration_score = max(0.0, 1.0 - delta / max(float(duration or 240), 90.0)) if duration else 0.5
        score = title_score * 0.70 + artist_score * 0.20 + duration_score * 0.10
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
    """Attach public Genius annotation bodies to the closest lyric line."""

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
            result.message = "Информация о треках отключена"
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
                genius = await self._genius(
                    session,
                    result.matched_artist or artist,
                    result.matched_title or title,
                    result.lines,
                )
                result.genius_status = genius.get("status", "error")
                if result.genius_status == "matched":
                    result.genius_url = genius.get("url")
                    attach_genius_referents(result.lines, genius.get("referents") or [])
                    result.annotation_count = sum(len(line.annotations) for line in result.lines)

        if not result.lines:
            if result.genius_status == "matched":
                result.message = "Genius нашёл песню, но поставщик текстов не вернул текст этой записи"
            else:
                result.message = "Текст этой записи недоступен"
        elif result.match_type == "canonical":
            match = " — ".join(part for part in (result.matched_artist, result.matched_title) if part)
            result.message = f"Показано ближайшее точное совпадение песни: {match}"
        elif result.genius_status == "matched" and result.annotation_count == 0:
            result.message = "Genius нашёл песню, но сейчас не предоставляет публичных комментариев к строкам"
        elif result.genius_status == "not_found":
            result.message = "Текст найден, но Genius не подтвердил совпадение песни"
        elif result.genius_status == "error":
            result.message = "Текст найден, но Genius временно недоступен"
        elif not self.genius_access_token:
            result.message = "Добавь AWUN_GENIUS_ACCESS_TOKEN, чтобы показывать аннотации Genius"
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
            "User-Agent": f"SONGVALE/{APP_VERSION} (+https://github.com/Loro66/AWUN)",
            "Lrclib-Client": f"SONGVALE/{APP_VERSION}",
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
            candidate = select_lyric_candidate(
                payload if isinstance(payload, list) else [],
                canonical,
                duration,
                artist,
            )
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
        lines: Iterable[LyricLine] = (),
    ) -> dict[str, Any] | None:
        headers = {"Authorization": f"Bearer {self.genius_access_token}", "Accept": "application/json"}
        queries = genius_search_queries(artist, title, lines)
        try:
            song: dict[str, Any] | None = None
            best_score = 0.0
            for query in queries:
                async with session.get(
                    "https://api.genius.com/search",
                    params={"q": query},
                    headers=headers,
                ) as response:
                    response.raise_for_status()
                    hits = ((await response.json(content_type=None)).get("response") or {}).get("hits") or []
                selected = select_genius_candidate(hits, artist, title)
                if selected and selected[1] > best_score:
                    song, best_score = selected
                if best_score >= 0.92:
                    break
            if not song or not song.get("id"):
                return {"status": "not_found"}
            referents: list[dict[str, Any]] = []
            for page in (1, 2):
                async with session.get(
                    "https://api.genius.com/referents",
                    params={"song_id": song["id"], "text_format": "dom", "per_page": 50, "page": page},
                    headers=headers,
                ) as response:
                    response.raise_for_status()
                    payload = await response.json(content_type=None)
                response_data = payload.get("response") or {}
                referents.extend(response_data.get("referents") or [])
                next_page = response_data.get("next_page") or (payload.get("meta") or {}).get("next_page")
                if not next_page:
                    break
            return {
                "status": "matched",
                "url": song.get("url"),
                "title": song.get("title"),
                "artist": (song.get("primary_artist") or {}).get("name"),
                "referents": referents,
                "confidence": round(best_score, 3),
            }
        except (aiohttp.ClientError, TimeoutError, ValueError, AttributeError):
            return {"status": "error"}
