"""Match imported playlist metadata to playable AWUN results."""

from dataclasses import dataclass
from difflib import SequenceMatcher

from backend.core.models import Track
from backend.search.text_normalization import canonical_artist, canonical_title, token_overlap


@dataclass(frozen=True, slots=True)
class LibraryEntry:
    title: str
    artist: str = ""
    duration: int = 0
    isrc: str | None = None


@dataclass(frozen=True, slots=True)
class MatchResult:
    track: Track
    confidence: float
    reasons: tuple[str, ...]


def _duration_confidence(expected: int, actual: int) -> float:
    if not expected or not actual:
        return 0.5
    difference = abs(expected - actual)
    if difference <= 5:
        return 1.0
    if difference >= 40:
        return 0.0
    return 1 - difference / 40


def score_library_match(entry: LibraryEntry, track: Track) -> MatchResult:
    expected_title = canonical_title(entry.title)
    actual_title = canonical_title(track.title)
    expected_artist = canonical_artist(entry.artist)
    actual_artist = canonical_artist(track.artist)

    title = max(
        token_overlap(expected_title, actual_title),
        SequenceMatcher(None, expected_title, actual_title).ratio(),
    )
    artist = (
        max(
            token_overlap(expected_artist, actual_artist),
            SequenceMatcher(None, expected_artist, actual_artist).ratio(),
        )
        if expected_artist
        else 0.65
    )
    duration = _duration_confidence(entry.duration, track.duration)
    confidence = round(title * 0.58 + artist * 0.3 + duration * 0.12, 4)

    reasons: list[str] = []
    if title >= 0.9:
        reasons.append("title")
    if artist >= 0.9 and expected_artist:
        reasons.append("artist")
    if duration >= 0.9 and entry.duration:
        reasons.append("duration")
    return MatchResult(track, confidence, tuple(reasons))


def best_library_match(
    entry: LibraryEntry,
    candidates: list[Track],
    *,
    minimum_confidence: float = 0.78,
) -> MatchResult | None:
    if not 0 <= minimum_confidence <= 1:
        raise ValueError("minimum_confidence must be between zero and one")
    if not candidates:
        return None
    ranked = sorted(
        (score_library_match(entry, track) for track in candidates),
        key=lambda result: (-result.confidence, -result.track.score, result.track.id),
    )
    return ranked[0] if ranked[0].confidence >= minimum_confidence else None
