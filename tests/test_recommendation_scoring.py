import pytest

from backend.core.models import Track
from backend.recommendations.scoring import (
    score_recommendation,
    select_diverse_recommendations,
)
from backend.recommendations.taste_profile import TasteProfile


def track(identifier: str, artist: str, *, score: float = 80) -> Track:
    return Track(
        id=identifier,
        title=f"Song {identifier}",
        artist=artist,
        duration=240,
        quality="320",
        source="audius",
        stream_url="https://example.com/audio",
        score=score,
    )


def profile() -> TasteProfile:
    return TasteProfile(
        artist_weights={"favorite": 1.0, "disliked": -1.0},
        source_weights={"audius": 0.5},
        preferred_duration=240,
        disliked_artists=frozenset({"disliked"}),
        sample_count=10,
    )


def test_favorite_artist_beats_unknown_artist() -> None:
    favorite = score_recommendation(track("one", "Favorite"), profile())
    unknown = score_recommendation(track("two", "Unknown"), profile())

    assert favorite.score > unknown.score
    assert "artist_affinity" in favorite.reasons


def test_recent_track_receives_strong_penalty() -> None:
    item = track("recent", "Favorite")
    fresh = score_recommendation(item, profile())
    recent = score_recommendation(item, profile(), recently_played_ids={"recent"})

    assert fresh.score - recent.score == pytest.approx(40)


def test_disliked_artist_is_never_selected() -> None:
    disliked = track("bad", "Disliked")
    selected = select_diverse_recommendations([disliked], profile())

    assert selected == []


def test_selection_caps_each_artist_for_diversity() -> None:
    candidates = [track(f"favorite-{index}", "Favorite") for index in range(5)]
    candidates.extend([track("other", "Other")])
    selected = select_diverse_recommendations(candidates, profile(), limit=4, max_per_artist=2)

    assert [item.track.artist for item in selected].count("Favorite") == 2
    assert any(item.track.artist == "Other" for item in selected)


def test_invalid_selection_limits_are_rejected() -> None:
    with pytest.raises(ValueError):
        select_diverse_recommendations([], profile(), limit=0)
