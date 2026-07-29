import pytest

from backend.core.models import Track
from backend.library.matcher import LibraryEntry, best_library_match, score_library_match


def track(title: str, artist: str, duration: int, *, score: float = 70) -> Track:
    return Track(
        id=f"{artist}:{title}",
        title=title,
        artist=artist,
        duration=duration,
        quality="192",
        source="soundcloud",
        stream_url="https://example.com/audio",
        score=score,
    )


def test_exact_import_match_has_explainable_high_confidence() -> None:
    entry = LibraryEntry("Dayvan Cowboy", "Boards of Canada", 302)
    result = score_library_match(entry, track("Dayvan Cowboy (Official Audio)", "Boards of Canada", 300))

    assert result.confidence >= 0.95
    assert result.reasons == ("title", "artist", "duration")


def test_best_match_rejects_unrelated_high_provider_score() -> None:
    entry = LibraryEntry("Группа крови", "Кино", 280)
    exact = track("Группа крови", "Кино", 282, score=40)
    unrelated = track("Лучшие песни", "Various", 3600, score=99)

    result = best_library_match(entry, [unrelated, exact])
    assert result is not None
    assert result.track is exact


def test_title_only_import_can_match_without_artist() -> None:
    result = best_library_match(
        LibraryEntry("Teardrop"),
        [track("Teardrop", "Massive Attack", 330)],
    )

    assert result is not None


def test_low_confidence_match_returns_none() -> None:
    result = best_library_match(
        LibraryEntry("Song A", "Artist A"),
        [track("Completely Different", "Nobody", 100)],
    )

    assert result is None


def test_invalid_threshold_is_rejected() -> None:
    with pytest.raises(ValueError):
        best_library_match(LibraryEntry("Song"), [], minimum_confidence=2)
