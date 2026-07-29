from backend.core.models import Track
from backend.library.deduplication import deduplicate_library, group_library_duplicates


def track(
    identifier: str,
    *,
    title: str = "Song",
    duration: int = 180,
    score: float = 50,
    download: bool = False,
) -> Track:
    return Track(
        id=identifier,
        title=title,
        artist="Artist",
        duration=duration,
        quality="192",
        source="internet_archive",
        stream_url="https://example.com/audio",
        download_url="https://example.com/audio" if download else None,
        score=score,
    )


def test_exact_duplicates_are_grouped_without_data_loss() -> None:
    first = track("first")
    second = track("second", score=70)

    groups = group_library_duplicates([first, second])
    assert len(groups) == 1
    assert {item.id for item in groups[0].all_tracks} == {"first", "second"}
    assert groups[0].primary is second


def test_provider_title_noise_is_grouped() -> None:
    clean = track("clean", title="Song")
    noisy = track("noisy", title="Song (Official Video)")

    assert len(group_library_duplicates([clean, noisy])) == 1


def test_distinct_versions_remain_separate() -> None:
    studio = track("studio", title="Song", duration=180)
    live = track("live", title="Song Live at Wembley", duration=260)

    assert len(group_library_duplicates([studio, live])) == 2


def test_downloadable_copy_wins_equal_relevance() -> None:
    stream = track("stream", score=70)
    download = track("download", score=70, download=True)

    assert deduplicate_library([stream, download]) == [download]


def test_input_order_is_preserved_for_unrelated_tracks() -> None:
    first = track("first", title="First")
    second = track("second", title="Second")

    assert deduplicate_library([first, second]) == [first, second]
