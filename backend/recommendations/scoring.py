"""Transparent candidate scoring and diversity selection for AWUN Flow."""

from dataclasses import dataclass

from backend.core.models import Track
from backend.recommendations.taste_profile import TasteProfile
from backend.search.text_normalization import canonical_artist


@dataclass(frozen=True, slots=True)
class RecommendationScore:
    track: Track
    score: float
    reasons: tuple[str, ...]


def score_recommendation(
    track: Track,
    profile: TasteProfile,
    *,
    recently_played_ids: set[str] | None = None,
) -> RecommendationScore:
    artist = canonical_artist(track.artist)
    if artist in profile.disliked_artists:
        return RecommendationScore(track, -100.0, ("disliked_artist",))

    artist_affinity = profile.artist_weights.get(artist, 0.0)
    source_affinity = profile.source_weights.get(track.source, 0.0)
    duration_affinity = 0.5
    if profile.preferred_duration and track.duration:
        difference = abs(profile.preferred_duration - track.duration)
        duration_affinity = max(0.0, 1 - difference / max(60, profile.preferred_duration))
    freshness = -1.0 if track.id in (recently_played_ids or set()) else 1.0
    quality = track.score / 100
    total = (
        artist_affinity * 38
        + source_affinity * 12
        + duration_affinity * 12
        + freshness * 20
        + quality * 18
    )

    reasons: list[str] = []
    if artist_affinity > 0.2:
        reasons.append("artist_affinity")
    if source_affinity > 0.2:
        reasons.append("source_affinity")
    if duration_affinity > 0.8:
        reasons.append("duration")
    if freshness > 0:
        reasons.append("fresh")
    return RecommendationScore(track, round(total, 3), tuple(reasons))


def select_diverse_recommendations(
    candidates: list[Track],
    profile: TasteProfile,
    *,
    limit: int = 20,
    recently_played_ids: set[str] | None = None,
    max_per_artist: int = 2,
) -> list[RecommendationScore]:
    if limit < 1 or max_per_artist < 1:
        raise ValueError("recommendation limits must be positive")
    ranked = sorted(
        (
            score_recommendation(
                track,
                profile,
                recently_played_ids=recently_played_ids,
            )
            for track in candidates
        ),
        key=lambda item: (-item.score, item.track.id),
    )
    selected: list[RecommendationScore] = []
    artist_counts: dict[str, int] = {}
    for item in ranked:
        if item.score <= -100:
            continue
        artist = canonical_artist(item.track.artist)
        if artist_counts.get(artist, 0) >= max_per_artist:
            continue
        artist_counts[artist] = artist_counts.get(artist, 0) + 1
        selected.append(item)
        if len(selected) >= limit:
            break
    return selected
