import asyncio
from copy import deepcopy
from dataclasses import asdict
from time import perf_counter
from urllib.parse import quote, quote_plus

from backend.analytics.search_metrics import SearchMetrics
from backend.core.models import SearchRequest, SearchResponse, SourceName, Track
from backend.core.regions import RegionProfile, resolve_region
from backend.reliability.circuit_breaker import CircuitBreaker
from backend.reliability.source_health import SourceHealthRegistry
from backend.reliability.ttl_cache import TTLCache
from backend.search.enrichment import BasicQueryEnricher, QueryEnricher, basic_query_variants
from backend.search.track_identity import same_recording
from backend.sources.base import BaseAdapter


class SearchEngine:
    _MAX_BACKGROUND_ENRICHMENTS = 8

    def __init__(
        self,
        adapters: list[BaseAdapter],
        timeout_seconds: float = 20.0,
        fast_timeout_seconds: float = 6.0,
        max_limit: int = 30,
        enricher: QueryEnricher | None = None,
        cache_ttl_seconds: float = 90.0,
        cache_max_size: int = 256,
        enrichment_wait_seconds: float = 0.2,
    ) -> None:
        self._adapters = {adapter.source: adapter for adapter in adapters}
        self._timeout = timeout_seconds
        self._fast_timeout = min(timeout_seconds, max(0.05, fast_timeout_seconds))
        self._max_limit = max_limit
        self._enricher = enricher or BasicQueryEnricher()
        self._breakers = {
            source: CircuitBreaker(failure_threshold=3, recovery_seconds=30)
            for source in self._adapters
        }
        self._health = SourceHealthRegistry(list(self._adapters))
        self._metrics = SearchMetrics()
        self._cache = TTLCache[tuple[object, ...], SearchResponse](
            ttl_seconds=cache_ttl_seconds,
            max_size=cache_max_size,
        )
        self._enrichment_wait = max(0.01, enrichment_wait_seconds)
        self._inflight: dict[tuple[object, ...], asyncio.Task[SearchResponse]] = {}
        self._background_tasks: set[asyncio.Task[list[str]]] = set()

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
        data: dict[str, object] = asdict(self._metrics.snapshot())
        data["cache"] = asdict(self._cache.stats)
        return data

    async def search(self, request: SearchRequest) -> SearchResponse:
        started = perf_counter()
        cache_key = self._cache_key(request)
        cached = self._cache.get(cache_key)
        if cached is not None:
            response = deepcopy(cached)
            response.elapsed_ms = round((perf_counter() - started) * 1000)
            self._metrics.record_search(
                elapsed_ms=response.elapsed_ms,
                result_count=len(response.tracks),
            )
            return response

        task = self._inflight.get(cache_key)
        if task is None:
            task = asyncio.create_task(self._search_and_cache(request, cache_key))
            self._inflight[cache_key] = task
            task.add_done_callback(
                lambda finished, key=cache_key: self._clear_inflight(key, finished)
            )
        response = await asyncio.shield(task)
        return deepcopy(response)

    async def _search_and_cache(
        self,
        request: SearchRequest,
        cache_key: tuple[object, ...],
    ) -> SearchResponse:
        response = await self._search_uncached(request)
        if response.tracks and not response.errors:
            self._cache.set(cache_key, deepcopy(response))
        return response

    def _clear_inflight(
        self,
        key: tuple[object, ...],
        task: asyncio.Task[SearchResponse],
    ) -> None:
        if self._inflight.get(key) is task:
            self._inflight.pop(key, None)

    async def _search_uncached(self, request: SearchRequest) -> SearchResponse:
        started = perf_counter()
        requested = request.sources or self.available_sources
        selected = [source for source in requested if source in self._adapters]
        per_source_limit = min(request.limit, self._max_limit)
        region = resolve_region(request.region, request.locale)
        query_variants = await self._fast_query_variants(request.query, region)

        errors: dict[str, str] = {
            source: "Источник не настроен"
            for source in requested
            if source not in self._adapters
        }
        if not requested:
            errors["engine"] = "Источники поиска не настроены"

        tracks_by_source: dict[str, list[Track]] = {}
        searched_sources: list[SourceName] = []
        tasks = {
            asyncio.create_task(
                self._safe_search(
                    self._adapters[source],
                    query_variants,
                    per_source_limit,
                    region,
                )
            ): source
            for source in selected
        }
        if request.fast:
            pending = set(tasks)
            deadline = asyncio.get_running_loop().time() + self._fast_timeout
            while pending:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    break
                completed, pending = await asyncio.wait(
                    pending,
                    timeout=remaining,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not completed:
                    break
                for task in completed:
                    source = tasks[task]
                    source_tracks, error = task.result()
                    searched_sources.append(source)
                    tracks_by_source[source] = source_tracks
                    if error:
                        errors[source] = error
                if any(tracks_by_source.values()):
                    break
            if pending:
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                if not any(tracks_by_source.values()):
                    for task in pending:
                        source = tasks[task]
                        errors.setdefault(
                            source,
                            f"Источник не успел ответить за {self._fast_timeout:g} с",
                        )
                        searched_sources.append(source)
        else:
            results = await asyncio.gather(*tasks)
            for source, (source_tracks, error) in zip(selected, results, strict=True):
                searched_sources.append(source)
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
            searched_sources=[source for source in selected if source in searched_sources],
            region=request.region,
            query_variants=query_variants,
            errors=errors,
            elapsed_ms=elapsed_ms,
        )

    def _cache_key(self, request: SearchRequest) -> tuple[object, ...]:
        sources = tuple(request.sources or self.available_sources)
        query = " ".join(request.query.casefold().split())
        locale = (request.locale or "").replace("_", "-").casefold()
        return query, request.limit, sources, request.region, locale, request.fast

    async def _fast_query_variants(
        self,
        query: str,
        region: RegionProfile,
    ) -> list[str]:
        """Use cached enrichment immediately and never block a cold search on it.

        MusicBrainz rate limits anonymous clients to one request per second.
        A cold enrichment continues in the background and warms its own cache;
        the active search starts after a short budget with local variants.
        """

        if len(self._background_tasks) >= self._MAX_BACKGROUND_ENRICHMENTS:
            return basic_query_variants(query)

        task = asyncio.create_task(self._enricher.expand(query, region))
        try:
            return await asyncio.wait_for(
                asyncio.shield(task),
                timeout=min(self._enrichment_wait, self._timeout / 4),
            )
        except TimeoutError:
            if len(self._background_tasks) >= self._MAX_BACKGROUND_ENRICHMENTS:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                return basic_query_variants(query)
            self._background_tasks.add(task)
            task.add_done_callback(self._consume_background_task)
            return basic_query_variants(query)
        except Exception:
            return basic_query_variants(query)

    def _consume_background_task(self, task: asyncio.Task[list[str]]) -> None:
        self._background_tasks.discard(task)
        try:
            task.result()
        except (Exception, asyncio.CancelledError):
            pass

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
        pending = set(self._background_tasks) | set(self._inflight.values())
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        await asyncio.gather(
            *(adapter.close() for adapter in self._adapters.values()),
            self._enricher.close(),
        )
