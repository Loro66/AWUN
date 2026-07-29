import pytest

from backend.search.query_plan import build_query_plan


def fake_transliterate(value: str) -> str:
    return value.replace("Кино", "Kino").replace("Группа крови", "Gruppa krovi")


def test_plan_orders_original_transliteration_alias_release_and_isrc() -> None:
    plan = build_query_plan(
        "Кино - Группа крови",
        artist_aliases=["Kino"],
        release_titles=["Последний герой"],
        isrcs=["RUA1A0100001"],
        transliterator=fake_transliterate,
        limit=8,
    )

    assert plan.variants[0] == "Кино Группа крови"
    assert "Kino Gruppa krovi" in plan.variants
    assert "Kino Группа крови" in plan.variants
    assert "Кино Группа крови Последний герой" in plan.variants
    assert "RUA1A0100001" in plan.variants


def test_plan_is_case_insensitively_unique() -> None:
    plan = build_query_plan(
        "Artist - Song",
        artist_aliases=["artist", "ARTIST"],
        isrcs=["USAAA0000001", "usaaa0000001"],
    )

    assert len({item.casefold() for item in plan.variants}) == len(plan.variants)


def test_provider_plan_prefers_audio_for_precise_youtube_query() -> None:
    plan = build_query_plan("Artist - Song")

    assert plan.for_provider("youtube")[0] == "Artist Song audio"
    assert plan.for_provider("audius") == plan.variants


def test_limit_bounds_external_provider_requests() -> None:
    plan = build_query_plan(
        "Artist - Song",
        artist_aliases=[f"Alias {index}" for index in range(20)],
        limit=4,
    )

    assert len(plan.variants) == 4


def test_non_positive_limit_is_rejected() -> None:
    with pytest.raises(ValueError, match="positive"):
        build_query_plan("Song", limit=0)
