import asyncio
from time import perf_counter

from backend.core.models import SearchRequest, SearchResponse, SourceName, Track
from backend.sources.base import BaseAdapter


class SearchEngine:
    def __init__(self, adapters: list[BaseAdapter], timeout_seconds: float = 20.0, max_limit: int = 30) -> None:
        self._adapters = {adapter.source: adapter for adapter in adapters}
        self._timeout = timeout_seconds
        self._max_limit = max_limit

    @property
    def available_sources(self) -> list[SourceName]:
        return list(self._adapters)  # type: ignore[return-value]

    async def search(self, request: SearchRequest) -> SearchResponse:
        started = perf_counter()
        requested = request.sources or self.available_sources
        selected = [source for source in requested if source in self._adapters]
        per_source_limit = min(request.limit, self._max_limit)

        errors: dict[str, str] = {
            source: "Source is not configured"
            for source in requested
            if source not in self._adapters
        }
        if not requested:
            errors["engine"] = "No search sources are configured"

        tasks = [self._safe_search(self._adapters[source], request.query, per_source_limit) for source in selected]
        results = await asyncio.gather(*tasks)

        tracks: list[Track] = []
        for source, (source_tracks, error) in zip(selected, results, strict=True):
            tracks.extend(source_tracks)
            if error:
                errors[source] = error

        tracks.sort(key=lambda track: (-track.score, track.source, track.title.casefold()))
        tracks = self._deduplicate(tracks)[: request.limit]
        elapsed_ms = round((perf_counter() - started) * 1000)
        return SearchResponse(
            query=request.query,
            tracks=tracks,
            total=len(tracks),
            searched_sources=selected,
            errors=errors,
            elapsed_ms=elapsed_ms,
        )

    async def _safe_search(self, adapter: BaseAdapter, query: str, limit: int) -> tuple[list[Track], str | None]:
        try:
            tracks = await asyncio.wait_for(adapter.search(query, limit), timeout=self._timeout)
            return tracks, None
        except TimeoutError:
            return [], f"Timed out after {self._timeout:g} seconds"
        except Exception as exc:
            return [], str(exc)

    @staticmethod
    def _deduplicate(tracks: list[Track]) -> list[Track]:
        seen: set[tuple[str, str, int]] = set()
        unique: list[Track] = []
        for track in tracks:
            key = (track.artist.casefold(), track.title.casefold(), round(track.duration / 3))
            if key not in seen:
                seen.add(key)
                unique.append(track)
        return unique

    async def close(self) -> None:
        await asyncio.gather(*(adapter.close() for adapter in self._adapters.values()))
