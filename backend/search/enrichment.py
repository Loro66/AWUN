import asyncio
from collections.abc import Iterable
from time import monotonic
from typing import Any, Protocol

import aiohttp

from backend.core.regions import RegionProfile


_CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya", "є": "ye",
    "і": "i", "ї": "yi", "ґ": "g",
}


def transliterate_cyrillic(value: str) -> str:
    output: list[str] = []
    changed = False
    for character in value:
        replacement = _CYRILLIC.get(character.casefold())
        if replacement is None:
            output.append(character)
            continue
        changed = True
        output.append(replacement.capitalize() if character.isupper() else replacement)
    return "".join(output).strip() if changed else value.strip()


def _unique(values: Iterable[str], limit: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = " ".join(str(value or "").split()).strip()
        key = normalized.casefold()
        if normalized and key not in seen:
            seen.add(key)
            result.append(normalized)
        if len(result) >= limit:
            break
    return result


def basic_query_variants(query: str, limit: int = 6) -> list[str]:
    return _unique((query, transliterate_cyrillic(query)), limit)


class QueryEnricher(Protocol):
    async def expand(self, query: str, region: RegionProfile) -> list[str]: ...

    async def close(self) -> None: ...


class BasicQueryEnricher:
    def __init__(self, limit: int = 6) -> None:
        self.limit = limit

    async def expand(self, query: str, region: RegionProfile) -> list[str]:
        return basic_query_variants(query, self.limit)

    async def close(self) -> None:
        return None


class MusicBrainzEnricher(BasicQueryEnricher):
    """Turn a human query into canonical recording, release, alias and ISRC queries."""

    api_url = "https://musicbrainz.org/ws/2"

    def __init__(self, contact: str, limit: int = 6, timeout: float = 8.0) -> None:
        super().__init__(limit)
        self.contact = contact.strip() or "https://github.com/Loro66/AWUN"
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self._session: aiohttp.ClientSession | None = None
        self._request_lock = asyncio.Lock()
        self._last_request = 0.0
        self._cache: dict[tuple[str, str, str | None], list[str]] = {}
        self._alias_cache: dict[str, list[dict[str, Any]]] = {}

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=self.timeout,
                headers={
                    "Accept": "application/json",
                    "User-Agent": f"AWUN/1.5 ({self.contact})",
                },
            )
        return self._session

    async def _get(self, path: str, params: dict[str, str]) -> dict[str, Any]:
        # MusicBrainz asks unauthenticated clients to stay at one request/second.
        async with self._request_lock:
            wait = 1.05 - (monotonic() - self._last_request)
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                async with (await self._get_session()).get(
                    f"{self.api_url}/{path}", params=params
                ) as response:
                    payload = await response.json(content_type=None)
                    if response.status != 200 or not isinstance(payload, dict):
                        raise RuntimeError(f"MusicBrainz returned HTTP {response.status}")
                    return payload
            finally:
                self._last_request = monotonic()

    async def expand(self, query: str, region: RegionProfile) -> list[str]:
        cache_key = (query.casefold(), region.name, region.language)
        if cache_key in self._cache:
            return list(self._cache[cache_key])
        try:
            payload = await self._get(
                "recording/",
                {"query": query, "fmt": "json", "limit": "3"},
            )
            recordings = payload.get("recordings") or []
            artist_id = self._first_artist_id(recordings)
            aliases = await self._artist_aliases(artist_id) if artist_id else []
            variants = self.variants_from_payload(query, payload, region, aliases, self.limit)
        except (aiohttp.ClientError, TimeoutError, RuntimeError, ValueError):
            variants = basic_query_variants(query, self.limit)
        self._cache[cache_key] = variants
        return list(variants)

    async def _artist_aliases(self, artist_id: str) -> list[dict[str, Any]]:
        if artist_id in self._alias_cache:
            return self._alias_cache[artist_id]
        payload = await self._get(
            f"artist/{artist_id}",
            {"inc": "aliases", "fmt": "json"},
        )
        aliases = payload.get("aliases") or []
        result = [alias for alias in aliases if isinstance(alias, dict)]
        self._alias_cache[artist_id] = result
        return result

    @staticmethod
    def _first_artist_id(recordings: Any) -> str | None:
        if not isinstance(recordings, list):
            return None
        for recording in recordings:
            credits = recording.get("artist-credit") if isinstance(recording, dict) else None
            if isinstance(credits, list):
                for credit in credits:
                    artist = credit.get("artist") if isinstance(credit, dict) else None
                    artist_id = artist.get("id") if isinstance(artist, dict) else None
                    if artist_id:
                        return str(artist_id)
        return None

    @classmethod
    def variants_from_payload(
        cls,
        query: str,
        payload: dict[str, Any],
        region: RegionProfile,
        aliases: list[dict[str, Any]] | None = None,
        limit: int = 6,
    ) -> list[str]:
        values: list[str] = basic_query_variants(query, limit)
        recordings = payload.get("recordings") or []
        if not isinstance(recordings, list):
            return values
        preferred_aliases = cls._preferred_aliases(aliases or [], region)
        for recording in recordings[:3]:
            if not isinstance(recording, dict):
                continue
            title = str(recording.get("title") or "").strip()
            artist = cls._artist_credit(recording.get("artist-credit"))
            if title and artist:
                values.append(f"{artist} {title}")
                values.extend(f"{alias} {title}" for alias in preferred_aliases[:1])
            isrcs = recording.get("isrcs") or []
            if isinstance(isrcs, list):
                values.extend(str(isrc) for isrc in isrcs[:1])
            releases = recording.get("releases") or []
            if title and artist and isinstance(releases, list):
                release = next(
                    (
                        str(item.get("title") or "").strip()
                        for item in releases
                        if isinstance(item, dict) and item.get("title")
                    ),
                    "",
                )
                if release and release.casefold() != title.casefold():
                    values.append(f"{artist} {title} {release}")
        return _unique(values, limit)

    @staticmethod
    def _artist_credit(credits: Any) -> str:
        if not isinstance(credits, list):
            return ""
        parts: list[str] = []
        for credit in credits:
            if not isinstance(credit, dict):
                continue
            name = credit.get("name")
            artist = credit.get("artist") if isinstance(credit.get("artist"), dict) else {}
            parts.append(str(name or artist.get("name") or ""))
            parts.append(str(credit.get("joinphrase") or ""))
        return "".join(parts).strip()

    @staticmethod
    def _preferred_aliases(aliases: list[dict[str, Any]], region: RegionProfile) -> list[str]:
        ranked = sorted(
            aliases,
            key=lambda alias: (
                str(alias.get("locale") or "").split("-")[0] not in region.alias_locales,
                alias.get("primary") is not True,
            ),
        )
        return _unique((str(alias.get("name") or "") for alias in ranked), 3)

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
