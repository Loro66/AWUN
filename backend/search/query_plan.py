"""Build a bounded provider query plan from intent and metadata aliases."""

from collections.abc import Callable, Iterable
from dataclasses import dataclass

from backend.search.query_intent import QueryIntent, parse_query_intent
from backend.search.text_normalization import display_text


@dataclass(frozen=True, slots=True)
class QueryPlan:
    original: str
    variants: tuple[str, ...]
    artist: str = ""
    title: str = ""

    def for_provider(self, provider: str) -> tuple[str, ...]:
        """Apply conservative provider hints without changing recording identity."""

        if provider == "youtube" and self.artist and self.title:
            preferred = f"{self.artist} {self.title} audio"
            return tuple(dict.fromkeys((preferred, *self.variants)))
        return self.variants


def _unique(values: Iterable[str], limit: int) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = display_text(value)
        key = cleaned.casefold()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
        if len(result) >= limit:
            break
    return tuple(result)


def build_query_plan(
    query: str,
    *,
    artist_aliases: Iterable[str] = (),
    release_titles: Iterable[str] = (),
    isrcs: Iterable[str] = (),
    transliterator: Callable[[str], str] | None = None,
    limit: int = 8,
) -> QueryPlan:
    """Build ordered variants and cap provider traffic at the requested limit."""

    if limit < 1:
        raise ValueError("Query plan limit must be positive")
    intent: QueryIntent = parse_query_intent(query)
    values: list[str] = intent.variants()
    if transliterator:
        transliterated = transliterator(intent.canonical_query)
        if transliterated:
            values.append(transliterated)

    if intent.title:
        values.extend(
            f"{alias} {intent.title}"
            for alias in artist_aliases
            if display_text(alias)
        )
    if intent.artist and intent.title:
        values.extend(
            f"{intent.artist} {intent.title} {release}"
            for release in release_titles
            if display_text(release)
        )
    values.extend(display_text(isrc) for isrc in isrcs)

    variants = _unique(values, limit)
    return QueryPlan(
        original=intent.original,
        variants=variants,
        artist=intent.artist,
        title=intent.title,
    )
