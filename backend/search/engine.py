import asyncio
from time import perf_counter
from urllib.parse import quote, quote_plus

from backend.core.models import SearchRequest, SearchResponse, SourceName, Track
from backend.core.regions import RegionProfile, resolve_region
from backend.search.enrichment import BasicQueryEnricher, QueryEnricher
from backend.sources.base import BaseAdapter


class SearchEngine:
    def __init__(
        self,
        adapters: list[BaseAdapter],
        timeout_seconds: float = 20.0,
        max_limit: int = 30,
        enricher: QueryEnricher | None = None,
    ) -> None:
        self._adapters = {adapter.source: adapter for adapter in adapters}
        self._timeout = timeout_seconds
        self._max_limit = max_limit
        self._enricher = enricher or BasicQueryEnricher()

    @property
    def available_sources(self) -> list[SourceName]:
        return list(self._adapters)  # type: ignore[return-value]

    async def search(self, request: SearchRequest) -> SearchResponse:
        started = perf_counter()
        requested = request.sources or self.available_sources
        selected = [source for source in requested if source in self._adapters]
        per_source_limit = min(request.limit, self._max_limit)
        region = resolve_region(request.region, request.locale)
        try:
            query_variants = await asyncio.wait_for(
                self._enricher.expand(request.query, region),
                timeout=min(10.0, self._timeout / 2),
            )
        except Exception:
            query_variants = [request.query]

        errors: dict[str, str] = {
            source: "Source is not configured"
            for source in requested
            if source not in self._adapters
        }
        if not requested:
            errors["engine"] = "No search sources are configured"

        tasks = [
            self._safe_search(self._adapters[source], query_variants, per_source_limit, region)
            for source in selected
        ]
        results = await asyncio.gather(*tasks)

        tracks_by_source: dict[str, list[Track]] = {}
        for source, (source_tracks, error) in zip(selected, results, strict=True):
            tracks_by_source[source] = source_tracks
            if error:
                errors[source] = error

        tracks = self._merge_balanced(tracks_by_source, selected, request.limit)
        for track in tracks:
            track.catalog_links = self._catalog_links(track, region)
        elapsed_ms = round((perf_counter() - started) * 1000)
        return SearchResponse(
            query=request.query,
            tracks=tracks,
            total=len(tracks),
            searched_sources=selected,
            region=request.region,
            query_variants=query_variants,
            errors=errors,
            elapsed_ms=elapsed_ms,
        )

    async def _safe_search(
        self,
        adapter: BaseAdapter,
        queries: list[str],
        limit: int,
        region: RegionProfile,
    ) -> tuple[list[Track], str | None]:
        try:
            tracks = await asyncio.wait_for(
                adapter.search_many(queries, limit, region=region),
                timeout=self._timeout,
            )
            return tracks, None
        except TimeoutError:
            return [], f"Timed out after {self._timeout:g} seconds"
        except Exception as exc:
            return [], str(exc)

    @staticmethod
    def _catalog_links(track: Track, region: RegionProfile) -> dict[str, str]:
        query = f"{track.artist} {track.title}".strip()
        return {
            "spotify": f"https://open.spotify.com/search/{quote(query, safe='')}",
            "apple_music": (
                f"https://music.apple.com/{region.apple_storefront}/search"
                f"?term={quote_plus(query)}"
            ),
        }

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

    @classmethod
    def _merge_balanced(
        cls,
        tracks_by_source: dict[str, list[Track]],
        source_order: list[SourceName],
        limit: int,
    ) -> list[Track]:
        """Keep the strongest duplicate, then fairly interleave active sources."""

        ranked = sorted(
            (track for tracks in tracks_by_source.values() for track in tracks),
            key=lambda track: (-track.score, track.source, track.title.casefold()),
        )
        unique = cls._deduplicate(ranked)

        queues: dict[str, list[Track]] = {source: [] for source in source_order}
        for track in unique:
            queues.setdefault(track.source, []).append(track)

        merged: list[Track] = []
        positions = {source: 0 for source in source_order}
        while len(merged) < limit:
            added = False
            for source in source_order:
                position = positions[source]
                queue = queues[source]
                if position >= len(queue):
                    continue
                merged.append(queue[position])
                positions[source] = position + 1
                added = True
                if len(merged) == limit:
                    break
            if not added:
                break
        return merged

    async def close(self) -> None:
        await asyncio.gather(
            *(adapter.close() for adapter in self._adapters.values()),
            self._enricher.close(),
        )
