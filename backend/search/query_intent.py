"""Parse a human music query into a small, explicit search intent."""

from dataclasses import dataclass
import re


_SEPARATORS = (
    re.compile(r"\s+[-–—]\s+"),
    re.compile(r"\s*::\s*"),
    re.compile(r"\s+\|\s+"),
)
_SPACE = re.compile(r"\s+")


def _clean(value: str) -> str:
    value = _SPACE.sub(" ", value).strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'«»":
        value = value[1:-1].strip()
    return value


@dataclass(frozen=True, slots=True)
class QueryIntent:
    """Structured form of a query without claiming more than the user supplied."""

    original: str
    artist: str = ""
    title: str = ""
    terms: tuple[str, ...] = ()
    explicit_pair: bool = False

    @property
    def canonical_query(self) -> str:
        if self.artist and self.title:
            return f"{self.artist} {self.title}"
        return self.title or self.artist or _clean(self.original)

    @property
    def display_query(self) -> str:
        if self.artist and self.title:
            return f"{self.artist} — {self.title}"
        return self.canonical_query

    def variants(self) -> list[str]:
        values = [self.canonical_query]
        if self.artist and self.title:
            values.extend(
                (
                    f"{self.title} {self.artist}",
                    f'"{self.title}" "{self.artist}"',
                )
            )
        return list(dict.fromkeys(value for value in values if value))


def parse_query_intent(query: str) -> QueryIntent:
    """Recognize common ``artist - title`` forms while keeping plain queries intact."""

    original = _clean(query)
    for separator in _SEPARATORS:
        parts = separator.split(original, maxsplit=1)
        if len(parts) != 2:
            continue
        artist, title = (_clean(part) for part in parts)
        if artist and title:
            return QueryIntent(
                original=original,
                artist=artist,
                title=title,
                terms=tuple(_SPACE.split(f"{artist} {title}")),
                explicit_pair=True,
            )

    terms = tuple(term for term in _SPACE.split(original) if term)
    return QueryIntent(
        original=original,
        title=original,
        terms=terms,
        explicit_pair=False,
    )
