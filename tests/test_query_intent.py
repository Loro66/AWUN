import pytest

from backend.search.query_intent import QueryIntent, parse_query_intent


@pytest.mark.parametrize("separator", [" - ", " – ", " — ", " :: ", " | "])
def test_parses_artist_and_title_separators(separator: str) -> None:
    intent = parse_query_intent(f"Кино{separator}Группа крови")

    assert intent.artist == "Кино"
    assert intent.title == "Группа крови"
    assert intent.explicit_pair is True
    assert intent.canonical_query == "Кино Группа крови"
    assert intent.display_query == "Кино — Группа крови"


def test_plain_query_is_not_guessed_as_an_artist_pair() -> None:
    intent = parse_query_intent("Boards of Canada Dayvan Cowboy")

    assert intent.artist == ""
    assert intent.title == "Boards of Canada Dayvan Cowboy"
    assert intent.explicit_pair is False
    assert intent.terms == ("Boards", "of", "Canada", "Dayvan", "Cowboy")


def test_whitespace_and_matching_quotes_are_removed() -> None:
    intent = parse_query_intent('  "Кино   -   Спокойная ночь"  ')

    assert intent.original == "Кино - Спокойная ночь"
    assert intent.artist == "Кино"
    assert intent.title == "Спокойная ночь"


def test_variants_are_ordered_and_unique() -> None:
    intent = QueryIntent(original="A - B", artist="A", title="B", explicit_pair=True)

    assert intent.variants() == ["A B", "B A", '"B" "A"']


def test_empty_query_can_be_rejected_by_the_api_model_later() -> None:
    intent = parse_query_intent("   ")

    assert intent.canonical_query == ""
    assert intent.terms == ()
