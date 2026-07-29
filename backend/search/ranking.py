"""Explainable result ranking shared by search and recommendation flows."""

from dataclasses import dataclass
from math import log1p

from backend.core.models import Track
from backend.search.text_normalization import token_overlap


_SOURCE_CONFIDENCE = {
    "youtube": 0.86,
    "soundcloud": 0.78,
    "audius": 0.82,
    "jamendo": 0.8,
    "internet_archive": 0.72,
}


@dataclass(frozen=True, slots=True)
class RankingContext:
    query: str
    artist: str = ""
    title: str = ""
    expected_duration: int = 0
    prefer_downloadable: bool = False


@dataclass(frozen=True, slots=True)
class RankingResult:
    score: float
    reasons: tuple[str, ...]


def _duration_score(duration: int, expected: int) -> float:
    if not duration or not expected:
        return 0.5
    difference = abs(duration - expected)
    return max(0.0, 1 - difference / max(30, expected * 0.2))


def rank_track(track: Track, context: RankingContext) -> RankingResult:
    """Rank without provider-specific popularity numbers dominating relevance."""

    query_match = token_overlap(context.query, f"{track.artist} {track.title}")
    title_match = token_overlap(context.title, track.title) if context.title else query_match
    artist_match = token_overlap(context.artist, track.artist) if context.artist else query_match
    duration_match = _duration_score(track.duration, context.expected_duration)
    provider = _SOURCE_CONFIDENCE.get(track.source, 0.6)
    upstream = min(1.0, log1p(max(0.0, track.score)) / log1p(100))
    downloadable = 1.0 if track.download_url else 0.0

    score = (
        title_match * 42
        + artist_match * 22
        + query_match * 12
        + duration_match * 8
        + provider * 8
        + upstream * 8
    )
    if context.prefer_downloadable:
        score += downloadable * 4

    reasons: list[str] = []
    if title_match >= 0.8:
        reasons.append("title")
    if artist_match >= 0.8:
        reasons.append("artist")
    if duration_match >= 0.85 and context.expected_duration:
        reasons.append("duration")
    if downloadable and context.prefer_downloadable:
        reasons.append("downloadable")
    return RankingResult(round(min(100.0, score), 3), tuple(reasons))


def order_tracks(tracks: list[Track], context: RankingContext) -> list[Track]:
    """Return a stable ordering while leaving the provider objects untouched."""

    return sorted(
        tracks,
        key=lambda track: (
            -rank_track(track, context).score,
            -track.score,
            track.source,
            track.title.casefold(),
        ),
    )
