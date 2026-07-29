from backend.core.models import Track
from backend.recommendations.taste_profile import (
    Interaction,
    InteractionKind,
    build_taste_profile,
)


def track(artist: str, duration: int = 240, source: str = "audius") -> Track:
    return Track(
        id=f"{artist}:{duration}",
        title="Song",
        artist=artist,
        duration=duration,
        quality="320",
        source=source,
        stream_url="https://example.com/audio",
        score=80,
    )


def test_saved_artist_gets_stronger_weight_than_played_artist() -> None:
    profile = build_taste_profile(
        [
            Interaction(track("Favorite"), InteractionKind.SAVE),
            Interaction(track("Casual"), InteractionKind.PLAY),
        ]
    )

    assert profile.artist_weights["favorite"] == 1
    assert 0 < profile.artist_weights["casual"] < 1


def test_dislikes_are_explicitly_retained() -> None:
    profile = build_taste_profile(
        [Interaction(track("Never Again"), InteractionKind.DISLIKE)]
    )

    assert profile.disliked_artists == frozenset({"never again"})
    assert profile.artist_weights["never again"] == -1


def test_preferred_duration_uses_positive_interactions_only() -> None:
    profile = build_taste_profile(
        [
            Interaction(track("A", 200), InteractionKind.PLAY),
            Interaction(track("B", 300), InteractionKind.SAVE),
            Interaction(track("C", 900), InteractionKind.DISLIKE),
        ]
    )

    assert profile.preferred_duration == 280


def test_empty_history_returns_cold_start_profile() -> None:
    profile = build_taste_profile([])

    assert profile.sample_count == 0
    assert profile.preferred_duration == 0
    assert profile.artist_weights == {}
