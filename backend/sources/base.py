import asyncio
from abc import ABC, abstractmethod

from backend.core.models import SourceName, Track
from backend.core.regions import RegionProfile


class AdapterError(RuntimeError):
    """A recoverable source-specific search failure."""


class BaseAdapter(ABC):
    @property
    @abstractmethod
    def source(self) -> SourceName:
        raise NotImplementedError

    @abstractmethod
    async def search(
        self,
        query: str,
        limit: int,
        *,
        region: RegionProfile | None = None,
    ) -> list[Track]:
        """Return up to ``limit`` results without downloading media."""
        raise NotImplementedError

    async def search_many(
        self,
        queries: list[str],
        limit: int,
        *,
        region: RegionProfile | None = None,
    ) -> list[Track]:
        """Search the primary query first and use aliases concurrently to fill gaps.

        The previous implementation split the requested limit across three
        sequential provider calls. Most providers can satisfy the result
        window with the canonical query, so that strategy paid two additional
        network round trips in the common case. Alias calls run together so a
        sparse primary result pays one fallback round trip instead of two.
        """
        selected = queries[:3] or [""]
        tracks: list[Track] = []
        failures: list[Exception] = []
        seen: set[str] = set()

        try:
            primary = await self.search(selected[0], max(2, limit), region=region)
        except Exception as exc:
            failures.append(exc)
            primary = []
        for track in primary:
            if track.id not in seen:
                seen.add(track.id)
                tracks.append(track)
        if len(tracks) >= limit or len(selected) == 1:
            if not tracks and failures:
                raise failures[0]
            return tracks[:limit]

        remaining = max(2, limit - len(tracks))
        fallback_results = await asyncio.gather(
            *(self.search(query, remaining, region=region) for query in selected[1:]),
            return_exceptions=True,
        )
        for result in fallback_results:
            if isinstance(result, BaseException):
                if isinstance(result, Exception):
                    failures.append(result)
                continue
            found = result
            for track in found:
                if track.id not in seen:
                    seen.add(track.id)
                    tracks.append(track)
            if len(tracks) >= limit:
                break
        if not tracks and failures:
            raise failures[0]
        return tracks[:limit]

    async def close(self) -> None:
        """Release adapter resources when the app shuts down."""
