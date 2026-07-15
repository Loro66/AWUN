from abc import ABC, abstractmethod

import math

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
        """Search a small query plan while keeping provider traffic bounded."""
        selected = queries[:3] or [""]
        per_query = max(2, math.ceil(limit / len(selected)))
        tracks: list[Track] = []
        failures: list[Exception] = []
        seen: set[str] = set()
        for query in selected:
            try:
                found = await self.search(query, per_query, region=region)
            except Exception as exc:
                failures.append(exc)
                continue
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
