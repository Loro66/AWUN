"""Unicode-aware normalization helpers for music metadata."""

import re
import unicodedata


_BRACKETED_NOISE = re.compile(
    r"\s*[\[(]\s*(?:"
    r"official\s+(?:music\s+)?video|official\s+audio|lyrics?|visuali[sz]er|"
    r"audio|video|hd|hq|4k|remastered(?:\s+\d{4})?"
    r")\s*[\])]\s*",
    re.IGNORECASE,
)
_FEAT = re.compile(
    r"\s+(?:feat(?:uring)?\.?|ft\.?|при\s+участии)\s+.+$",
    re.IGNORECASE,
)
_PUNCTUATION = re.compile(r"[^\w\s]+", re.UNICODE)
_SPACE = re.compile(r"\s+")


def normalize_unicode(value: str) -> str:
    """Normalize compatibility characters and remove invisible formatting marks."""

    normalized = unicodedata.normalize("NFKC", value or "")
    return "".join(
        character
        for character in normalized
        if unicodedata.category(character) not in {"Cf", "Cc"} or character in "\t\n"
    )


def display_text(value: str) -> str:
    """Return safe, human-readable metadata without changing its language."""

    return _SPACE.sub(" ", normalize_unicode(value).replace("\n", " ")).strip()


def canonical_text(value: str) -> str:
    """Return a punctuation-insensitive comparison key."""

    cleaned = display_text(value).casefold().replace("&", " and ")
    cleaned = _PUNCTUATION.sub(" ", cleaned)
    return _SPACE.sub(" ", cleaned).strip()


def canonical_artist(value: str) -> str:
    """Normalize a primary artist while ignoring a trailing feature credit."""

    return canonical_text(_FEAT.sub("", display_text(value)))


def canonical_title(value: str) -> str:
    """Normalize a title and strip provider-added presentation labels."""

    cleaned = _BRACKETED_NOISE.sub(" ", display_text(value))
    cleaned = re.sub(r"\s+-\s+(?:official\s+)?(?:audio|video|lyrics?)$", "", cleaned, flags=re.I)
    return canonical_text(cleaned)


def comparison_tokens(value: str) -> frozenset[str]:
    """Create stable tokens and discard one-character search noise."""

    return frozenset(token for token in canonical_text(value).split() if len(token) > 1)


def token_overlap(left: str, right: str) -> float:
    """Return Jaccard similarity in the inclusive ``0..1`` range."""

    left_tokens = comparison_tokens(left)
    right_tokens = comparison_tokens(right)
    if not left_tokens and not right_tokens:
        return 1.0
    union = left_tokens | right_tokens
    return len(left_tokens & right_tokens) / len(union) if union else 0.0
