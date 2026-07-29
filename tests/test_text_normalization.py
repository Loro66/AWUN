import pytest

from backend.search.text_normalization import (
    canonical_artist,
    canonical_text,
    canonical_title,
    comparison_tokens,
    display_text,
    normalize_unicode,
    token_overlap,
)


def test_normalizes_compatibility_unicode_and_invisible_marks() -> None:
    assert normalize_unicode("ＡＷＵＮ\u200b") == "AWUN"


def test_display_text_collapses_lines_and_spaces() -> None:
    assert display_text("  Кино\n  Группа   крови ") == "Кино Группа крови"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Song (Official Video)", "song"),
        ("Song [Lyrics]", "song"),
        ("Song (Remastered 2024)", "song"),
        ("Song - Official Audio", "song"),
    ],
)
def test_canonical_title_removes_provider_noise(raw: str, expected: str) -> None:
    assert canonical_title(raw) == expected


def test_artist_feature_credit_does_not_change_primary_artist() -> None:
    assert canonical_artist("Massive Attack feat. Hope Sandoval") == "massive attack"


def test_canonical_text_is_case_and_punctuation_insensitive() -> None:
    assert canonical_text("  AC/DC & Friends ") == "ac dc and friends"


def test_comparison_tokens_drop_single_character_noise() -> None:
    assert comparison_tokens("A Song by X") == frozenset({"song", "by"})


def test_token_overlap_is_bounded_and_symmetric() -> None:
    left = token_overlap("Kino Gruppa Krovi", "Gruppa Krovi Kino")
    right = token_overlap("Gruppa Krovi Kino", "Kino Gruppa Krovi")

    assert left == right == 1.0
    assert token_overlap("one two", "three four") == 0.0
