"""Stable recording fingerprints for cross-provider deduplication."""

from dataclasses import dataclass
from difflib import SequenceMatcher
import re

from backend.core.models import Track
from backend.search.text_normalization import canonical_artist, canonical_title, token_overlap


def _duration_similarity(left: int, right: int) -> float:
    if not left or not right:
        return 0.65
    difference = abs(left - right)
    tolerance = max(8, round(max(left, right) * 0.04))
    if difference <= tolerance:
        return 1.0
    if difference >= 45:
        return 0.0
    return max(0.0, 1 - difference / 45)


@dataclass(frozen=True, slots=True)
class TrackFingerprint:
    artist: str
    title: str
    duration_bucket: int

    @classmethod
    def from_track(cls, track: Track) -> "TrackFingerprint":
        return cls.from_parts(track.artist, track.title, track.duration)

    @classmethod
    def from_parts(cls, artist: str, title: str, duration: int = 0) -> "TrackFingerprint":
        return cls(
            artist=canonical_artist(artist),
            title=canonical_title(title),
            duration_bucket=round(max(0, duration) / 5),
        )

    @property
    def key(self) -> tuple[str, str, int]:
        return self.artist, self.title, self.duration_bucket


def recording_similarity(left: TrackFingerprint, right: TrackFingerprint) -> float:
    """Blend artist, title and duration evidence into a deterministic score."""

    artist_sequence = SequenceMatcher(None, left.artist, right.artist).ratio()
    title_sequence = SequenceMatcher(None, left.title, right.title).ratio()
    artist_score = max(artist_sequence, token_overlap(left.artist, right.artist))
    title_score = max(title_sequence, token_overlap(left.title, right.title))
    duration_score = _duration_similarity(
        left.duration_bucket * 5,
        right.duration_bucket * 5,
    )
    return round(artist_score * 0.35 + title_score * 0.5 + duration_score * 0.15, 4)


def same_recording(left: Track, right: Track, *, threshold: float = 0.86) -> bool:
    """Decide whether two provider results represent the same recording."""

    left_fingerprint = TrackFingerprint.from_track(left)
    right_fingerprint = TrackFingerprint.from_track(right)
    if not left_fingerprint.artist or not left_fingerprint.title:
        return False
    left_numbers = tuple(re.findall(r"\d+", left_fingerprint.title))
    right_numbers = tuple(re.findall(r"\d+", right_fingerprint.title))
    if left_numbers != right_numbers:
        return False
    return recording_similarity(left_fingerprint, right_fingerprint) >= threshold


def identity_key(track: Track) -> tuple[str, str, int]:
    """Compatibility key for dictionaries and fast exact deduplication."""

    return TrackFingerprint.from_track(track).key
