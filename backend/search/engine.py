import asyncio
from dataclasses import asdict
from time import perf_counter
from urllib.parse import quote, quote_plus

from backend.analytics.search_metrics import SearchMetrics
from backend.core.models import SearchRequest, SearchResponse, SourceName, Track
from backend.core.regions import RegionProfile, resolve_region
from backend.reliability.circuit_breaker import CircuitBreaker
from backend.reliability.source_health import SourceHealthRegistry
from backend.search.enrichment import BasicQueryEnricher, QueryEnricher
from backend.search.track_identity import same_recording
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
        self._breakers = {
            source: CircuitBreaker(failure_threshold=3, recovery_seconds=30)
            for source in self._adapters
        }
        self._health = SourceHealthRegistry(list(self._adapters))
        self._metrics = SearchMetrics()

    @property
    def available_sources(self) -> list[SourceName]:
        return list(self._adapters)  # type: ignore[return-value]

    @property
    def source_health(self) -> dict[str, dict[str, object]]:
        return {
            source: asdict(health)
            for source, health in self._health.snapshot().items()
        }

    @property
    def metrics(self) -> dict[str, object]:
        return asdict(self._metrics.snapshot())

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
            source: "Источник не настроен"
            for source in requested
            if source not in self._adapters
        }
        if not requested:
            errors["engine"] = "Источники поиска не настроены"

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
        self._metrics.record_search(elapsed_ms=elapsed_ms, result_count=len(tracks))
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
        source = adapter.source
        breaker = self._breakers[source]
        if not breaker.allow_request():
            snapshot = breaker.snapshot
            return [], (
                "Источник временно отключён после повторных ошибок; "
                f"повтор через {snapshot.retry_after_seconds:g} с"
            )
        started = perf_counter()
        try:
            tracks = await asyncio.wait_for(
                adapter.search_many(queries, limit, region=region),
                timeout=self._timeout,
            )
            elapsed_ms = round((perf_counter() - started) * 1000)
            breaker.record_success()
            self._health.record(source, success=True, latency_ms=elapsed_ms)
            self._metrics.record_source(
                source,
                success=True,
                elapsed_ms=elapsed_ms,
                result_count=len(tracks),
            )
            return tracks, None
        except TimeoutError:
            error = f"Источник не ответил за {self._timeout:g} с"
        except Exception as exc:
            error = str(exc)
        elapsed_ms = round((perf_counter() - started) * 1000)
        breaker.record_failure()
        self._health.record(source, success=False, latency_ms=elapsed_ms, error=error)
        self._metrics.record_source(
            source,
            success=False,
            elapsed_ms=elapsed_ms,
            result_count=0,
        )
        return [], error

    @staticmethod
    def _catalog_links(track: Track, region: RegionProfile) -> dict[str, str]:
        query = f"{track.artist} {track.title}".strip()
        return {
            "spotify": f"https://open.spotify.com/search/{quote(query, safe='')}",
            "apple_music": (
                f"https://music.apple.com/{region.apple_storefront}/search"
                f"?term={quote_plus(query)}"
            ),
            "yandex_music": f"https://music.yandex.ru/search?text={quote_plus(query)}",
        }

    @staticmethod
    def _deduplicate(tracks: list[Track]) -> list[Track]:
        unique: list[Track] = []
        for track in tracks:
            if not any(
                same_recording(track, existing, threshold=0.97)
                for existing in unique
            ):
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
