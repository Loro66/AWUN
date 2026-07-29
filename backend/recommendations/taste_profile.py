"""Build a compact taste profile from local listening interactions."""

from collections import Counter
from dataclasses import dataclass
from enum import Enum

from backend.core.models import Track
from backend.search.text_normalization import canonical_artist


class InteractionKind(str, Enum):
    PLAY = "play"
    COMPLETE = "complete"
    SAVE = "save"
    SKIP = "skip"
    DISLIKE = "dislike"


_WEIGHTS = {
    InteractionKind.PLAY: 1.0,
    InteractionKind.COMPLETE: 2.0,
    InteractionKind.SAVE: 4.0,
    InteractionKind.SKIP: -1.5,
    InteractionKind.DISLIKE: -5.0,
}


@dataclass(frozen=True, slots=True)
class Interaction:
    track: Track
    kind: InteractionKind


@dataclass(frozen=True, slots=True)
class TasteProfile:
    artist_weights: dict[str, float]
    source_weights: dict[str, float]
    preferred_duration: int
    disliked_artists: frozenset[str]
    sample_count: int


def _normalized(counter: Counter[str]) -> dict[str, float]:
    if not counter:
        return {}
    scale = max(abs(value) for value in counter.values()) or 1
    return {key: round(value / scale, 3) for key, value in counter.items()}


def build_taste_profile(interactions: list[Interaction]) -> TasteProfile:
    artists: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    weighted_duration = 0.0
    positive_weight = 0.0

    for interaction in interactions:
        weight = _WEIGHTS[interaction.kind]
        artist = canonical_artist(interaction.track.artist)
        if artist:
            artists[artist] += weight
        sources[interaction.track.source] += weight
        if weight > 0 and interaction.track.duration:
            weighted_duration += interaction.track.duration * weight
            positive_weight += weight

    disliked = frozenset(artist for artist, weight in artists.items() if weight <= -3)
    preferred_duration = round(weighted_duration / positive_weight) if positive_weight else 0
    return TasteProfile(
        artist_weights=_normalized(artists),
        source_weights=_normalized(sources),
        preferred_duration=preferred_duration,
        disliked_artists=disliked,
        sample_count=len(interactions),
    )
