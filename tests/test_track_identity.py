from backend.core.models import Track
from backend.search.track_identity import (
    TrackFingerprint,
    identity_key,
    recording_similarity,
    same_recording,
)


def track(title: str, artist: str = "Кино", duration: int = 280) -> Track:
    return Track(
        id=f"{artist}:{title}:{duration}",
        title=title,
        artist=artist,
        duration=duration,
        quality="320",
        source="audius",
        stream_url="https://example.com/audio.mp3",
        score=80,
    )


def test_fingerprint_removes_provider_title_noise() -> None:
    clean = TrackFingerprint.from_track(track("Группа крови"))
    noisy = TrackFingerprint.from_track(track("Группа крови (Official Video)"))

    assert clean == noisy
    assert identity_key(track("Группа крови")) == clean.key


def test_small_duration_difference_is_same_recording() -> None:
    assert same_recording(track("Группа крови", duration=280), track("Группа крови", duration=284))


def test_live_version_is_not_forced_into_studio_recording() -> None:
    studio = track("Группа крови", duration=280)
    live = track("Группа крови Live at Luzhniki", duration=355)

    assert same_recording(studio, live) is False


def test_similarity_is_deterministic_and_bounded() -> None:
    left = TrackFingerprint.from_parts("Boards of Canada", "Dayvan Cowboy", 302)
    right = TrackFingerprint.from_parts("Boards Of Canada", "Dayvan Cowboy [Official Audio]", 300)
    score = recording_similarity(left, right)

    assert score == recording_similarity(right, left)
    assert 0.95 <= score <= 1.0


def test_missing_identity_is_not_deduplicated() -> None:
    assert same_recording(track("", artist=""), track("", artist="")) is False
