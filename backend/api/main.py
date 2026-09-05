from contextlib import asynccontextmanager
from pathlib import Path
import re
from typing import Annotated
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlparse

import aiohttp
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.core.config import Settings, get_settings
from backend.core.media import InvalidMediaToken, MediaSigner
from backend.core.models import (
    LibraryImportRequest,
    LibraryImportResponse,
    SearchRequest,
    SearchResponse,
    SourceName,
    TrackDetailsResponse,
)
from backend.core.regions import REGION_NAMES, RegionName
from backend.importers.library_url import LibraryImportError, LibraryUrlImporter
from backend.metadata.lyrics import TrackDetailsService
from backend.policy.client_capabilities import capabilities_for
from backend.policy.rights import SOURCE_RIGHTS
from backend.search.engine import SearchEngine
from backend.security.media_headers import sanitize_media_headers
from backend.security.safe_url import UnsafeUrl, validate_outbound_url
from backend.sources.factory import build_adapters, build_enricher


_CONTENT_EXTENSIONS = {
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
}
_PLAYLIST_CONTENT_TYPES = {
    "application/dash+xml",
    "application/mpegurl",
    "application/vnd.apple.mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl",
}
_HLS_URI_PATTERN = re.compile(r'URI="([^"]+)"')
_MAX_HLS_MANIFEST_BYTES = 512 * 1024


class CacheControlledStaticFiles(StaticFiles):
    """Cache fingerprinted UI assets aggressively and plain assets briefly."""

    async def get_response(self, path: str, scope: dict):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            query = parse_qs(scope.get("query_string", b"").decode("ascii", "ignore"))
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable"
                if "v" in query
                else "public, max-age=86400"
            )
        return response


def _safe_filename_stem(value: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return (value or "трек AWUN")[:120].rstrip(" .")


def _is_playlist(url: str, content_type: str) -> bool:
    media_type = content_type.partition(";")[0].strip().lower()
    path = urlparse(url).path.lower()
    return media_type in _PLAYLIST_CONTENT_TYPES or path.endswith((".m3u8", ".mpd"))


def _download_filename(stem: str, content_type: str, url: str) -> str:
    media_type = content_type.partition(";")[0].strip().lower()
    extension = _CONTENT_EXTENSIONS.get(media_type)
    if not extension:
        suffix = Path(urlparse(url).path).suffix.lower().lstrip(".")
        extension = suffix if suffix in {"aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "webm"} else "audio"
    return f"{_safe_filename_stem(stem)}.{extension}"


def _rewrite_hls_playlist(
    payload: bytes,
    *,
    upstream_url: str,
    proxy_base_url: str,
    signer: MediaSigner,
    headers: dict[str, str],
) -> bytes:
    """Proxy HLS playlist resources so the browser never contacts the CDN directly."""

    if len(payload) > _MAX_HLS_MANIFEST_BYTES:
        raise UnsafeUrl("HLS manifest is too large")
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise UnsafeUrl("HLS manifest is not valid UTF-8") from exc

    def proxied_uri(value: str) -> str:
        candidate = value.strip()
        if not candidate or candidate.startswith("data:"):
            return value
        absolute = urljoin(upstream_url, candidate)
        validated = validate_outbound_url(absolute)
        token = signer.sign(validated.url, headers)
        return f"{proxy_base_url.rstrip('/')}/{token}"

    rewritten: list[str] = []
    for line in text.splitlines():
        if line.startswith("#"):
            rewritten.append(
                _HLS_URI_PATTERN.sub(
                    lambda match: f'URI="{proxied_uri(match.group(1))}"',
                    line,
                )
            )
        elif line.strip():
            rewritten.append(proxied_uri(line))
        else:
            rewritten.append("")
    return ("\n".join(rewritten) + "\n").encode("utf-8")


def _apply_client_policy(response: SearchResponse, client_id: str | None) -> SearchResponse:
    capabilities = capabilities_for(client_id)
    for track in response.tracks:
        source_policy = SOURCE_RIGHTS.get(track.source)
        track.rights_terms_url = source_policy.terms_url if source_policy else None
        if capabilities.is_play_store:
            track.download_url = None
            track.rights_status = "play_store_stream_only"
        elif track.download_url:
            track.rights_status = "provider_supplied_download"
        else:
            track.rights_status = "stream_only"
    return response


async def _open_safe_media(
    session: aiohttp.ClientSession,
    url: str,
    *,
    headers: dict[str, str],
    max_redirects: int = 3,
):
    """Open public media while validating every redirect target."""

    current = url
    for redirect_index in range(max_redirects + 1):
        validated = validate_outbound_url(current)
        response = await session.get(
            validated.url,
            headers=headers,
            allow_redirects=False,
        )
        if response.status not in {301, 302, 303, 307, 308}:
            return response
        location = response.headers.get("location")
        response.release()
        if not location:
            raise UnsafeUrl("Media redirect does not contain a location")
        if redirect_index >= max_redirects:
            raise UnsafeUrl("Media source returned too many redirects")
        current = urljoin(validated.url, location)
    raise UnsafeUrl("Media redirect validation failed")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    media_signer = MediaSigner(settings.media_secret, settings.media_token_ttl_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.search_engine = SearchEngine(
            build_adapters(settings),
            timeout_seconds=settings.search_timeout_seconds,
            fast_timeout_seconds=settings.fast_search_timeout_seconds,
            max_limit=settings.max_limit,
            enricher=build_enricher(settings),
            cache_ttl_seconds=settings.search_cache_ttl_seconds,
            cache_max_size=settings.search_cache_max_size,
            enrichment_wait_seconds=settings.query_enrichment_wait_seconds,
        )
        app.state.track_details = TrackDetailsService(settings)
        app.state.library_importer = LibraryUrlImporter(
            settings.youtube_api_key,
            timeout_seconds=min(settings.search_timeout_seconds, 30),
        )
        yield
        await app.state.search_engine.close()
        await app.state.track_details.close()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Региональный поиск музыки по YouTube, SoundCloud, Audius, "
            "Jamendo и Internet Archive с обогащением данных через MusicBrainz."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=settings.cors_origins != ["*"],
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    def engine(request: Request) -> SearchEngine:
        return request.app.state.search_engine

    Engine = Annotated[SearchEngine, Depends(engine)]

    frontend_dir = Path(__file__).resolve().parents[2] / "frontend"
    project_dir = frontend_dir.parent
    if frontend_dir.is_dir():
        @app.get("/design-system.css", include_in_schema=False)
        async def design_system() -> Response:
            stylesheet = (frontend_dir / "design-system.css").read_text(encoding="utf-8")
            stylesheet = stylesheet.replace("__AWUN_VERSION__", settings.app_version)
            return Response(content=stylesheet, media_type="text/css; charset=utf-8")

        app.mount(
            "/static",
            CacheControlledStaticFiles(directory=frontend_dir),
            name="static",
        )

        @app.get("/", include_in_schema=False)
        async def frontend() -> Response:
            document = (frontend_dir / "index.html").read_text(encoding="utf-8")
            document = document.replace("__AWUN_VERSION__", settings.app_version)
            return Response(
                content=document,
                media_type="text/html; charset=utf-8",
                headers={"Cache-Control": "no-cache"},
            )

        @app.get("/service-worker.js", include_in_schema=False)
        async def service_worker() -> Response:
            worker = (frontend_dir / "service-worker.js").read_text(encoding="utf-8")
            worker = worker.replace("__AWUN_VERSION__", settings.app_version)
            return Response(
                content=worker,
                media_type="application/javascript",
                headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
            )

        @app.get("/privacy", include_in_schema=False)
        async def privacy_document() -> FileResponse:
            return FileResponse(
                frontend_dir / "privacy.html",
                media_type="text/html; charset=utf-8",
                headers={"Cache-Control": "public, max-age=3600"},
            )

        @app.get("/support", include_in_schema=False)
        async def support_document() -> FileResponse:
            return FileResponse(
                frontend_dir / "support.html",
                media_type="text/html; charset=utf-8",
                headers={"Cache-Control": "public, max-age=3600"},
            )

    @app.get("/license", include_in_schema=False)
    async def license_document() -> FileResponse:
        return FileResponse(
            project_dir / "LICENSE.md",
            media_type="text/markdown; charset=utf-8",
        )

    @app.get("/eula", include_in_schema=False)
    async def eula_document() -> FileResponse:
        return FileResponse(
            project_dir / "EULA.md",
            media_type="text/markdown; charset=utf-8",
        )

    @app.get("/health", tags=["система"])
    async def health(search_engine: Engine) -> dict[str, object]:
        return {
            "status": "ok",
            "version": settings.app_version,
            "sources": search_engine.available_sources,
            "source_health": search_engine.source_health,
            "regions": list(REGION_NAMES),
            "providers": {
                "youtube": {
                    "enabled": settings.youtube_enabled,
                    "api_key": bool(settings.youtube_api_key),
                    "fallback": settings.youtube_enabled,
                },
                "soundcloud": {
                    "enabled": settings.soundcloud_enabled,
                    "oauth": bool(settings.soundcloud_client_id and settings.soundcloud_client_secret),
                },
                "audius": {
                    "enabled": settings.audius_enabled,
                    "api_key": bool(settings.audius_api_key),
                    "legacy_read_only": settings.audius_enabled and not settings.audius_api_key,
                },
                "jamendo": {
                    "enabled": settings.jamendo_enabled,
                    "client_id": bool(settings.jamendo_client_id),
                },
                "internet_archive": {
                    "enabled": settings.internet_archive_enabled,
                    "downloadable_files": settings.internet_archive_enabled,
                },
                "musicbrainz": {
                    "enabled": settings.musicbrainz_enabled,
                    "query_expansion": settings.musicbrainz_enabled,
                },
                "yandex_music": {
                    "mode": "local_library_import_and_official_catalog_links",
                    "account_token_required": False,
                    "direct_audio": False,
                },
                "track_stories": {
                    "lyrics": settings.lyrics_enabled,
                    "lyrics_source": "lrclib" if settings.lyrics_enabled else None,
                    "genius_annotations": bool(settings.genius_access_token),
                    "local_line_comments": True,
                },
            },
        }

    @app.get(
        f"{settings.api_prefix}/track-details",
        response_model=TrackDetailsResponse,
        tags=["метаданные"],
    )
    async def track_details(
        request: Request,
        artist: Annotated[str, Query(min_length=1, max_length=200)],
        title: Annotated[str, Query(min_length=1, max_length=200)],
        duration: Annotated[int, Query(ge=0, le=24 * 60 * 60)] = 0,
    ) -> TrackDetailsResponse:
        service: TrackDetailsService = request.app.state.track_details
        return await service.get(artist=artist, title=title, duration=duration)

    def proxied(response: SearchResponse, request: Request) -> SearchResponse:
        response = _apply_client_policy(response, request.headers.get("x-awun-client"))
        base_url = str(request.base_url).rstrip("/")
        for track in response.tracks:
            if track.waveform_url and settings.media_proxy_enabled:
                waveform_token = media_signer.sign(track.waveform_url)
                track.waveform_url = f"{base_url}{settings.api_prefix}/media/{waveform_token}"
            if not settings.media_proxy_enabled:
                continue
            if track.source == "youtube":
                continue
            stream_token = media_signer.sign(track.stream_url, track.request_headers)
            track.stream_url = f"{base_url}{settings.api_prefix}/media/{stream_token}"
            if download_target := track.download_url:
                download_token = media_signer.sign(download_target, track.request_headers)
                query = urlencode(
                    {
                        "download": "1",
                        "filename": _safe_filename_stem(f"{track.artist} - {track.title}"),
                    }
                )
                track.download_url = f"{base_url}{settings.api_prefix}/media/{download_token}?{query}"
        return response

    @app.post(f"{settings.api_prefix}/search", response_model=SearchResponse, tags=["поиск"])
    async def search(body: SearchRequest, request: Request, search_engine: Engine) -> SearchResponse:
        if body.limit > settings.max_limit:
            raise HTTPException(422, f"Количество результатов не может превышать {settings.max_limit}")
        return proxied(await search_engine.search(body), request)

    @app.post(
        f"{settings.api_prefix}/library/import-url",
        response_model=LibraryImportResponse,
        tags=["медиатека"],
    )
    async def import_library_url(body: LibraryImportRequest, request: Request) -> LibraryImportResponse:
        """Read metadata from a public playlist; private-account access is deliberately unsupported."""
        importer: LibraryUrlImporter = request.app.state.library_importer
        try:
            return await importer.import_url(body.url, body.max_tracks)
        except LibraryImportError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.get(f"{settings.api_prefix}/search", response_model=SearchResponse, tags=["поиск"])
    async def search_get(
        search_engine: Engine,
        request: Request,
        q: Annotated[str, Query(min_length=1, max_length=200)],
        limit: Annotated[int, Query(ge=1, le=settings.max_limit)] = settings.default_limit,
        sources: Annotated[list[SourceName] | None, Query()] = None,
        region: Annotated[RegionName, Query()] = "AUTO",
        locale: Annotated[str | None, Query(max_length=35)] = None,
    ) -> SearchResponse:
        response = await search_engine.search(
            SearchRequest(
                query=q,
                limit=limit,
                sources=sources,
                region=region,
                locale=locale,
            )
        )
        return proxied(response, request)

    @app.get(f"{settings.api_prefix}/media/{{token}}", tags=["медиа"])
    async def media(
        token: str,
        request: Request,
        download: Annotated[bool, Query()] = False,
        filename: Annotated[str | None, Query(max_length=160)] = None,
    ) -> StreamingResponse:
        try:
            target = media_signer.verify(token)
        except InvalidMediaToken as exc:
            raise HTTPException(403, str(exc)) from exc

        outbound_headers = {
            "Accept": "*/*",
            **target.headers,
        }
        if byte_range := request.headers.get("range"):
            outbound_headers["Range"] = byte_range
        headers = sanitize_media_headers(
            outbound_headers,
            default_user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 Chrome/131 Safari/537.36"
            ),
        )

        session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=None, connect=settings.media_connect_timeout_seconds)
        )
        try:
            upstream = await _open_safe_media(session, target.url, headers=headers)
        except (aiohttp.ClientError, TimeoutError, UnsafeUrl) as exc:
            await session.close()
            raise HTTPException(502, "Источник аудио сейчас недоступен") from exc

        if upstream.status not in {200, 206}:
            upstream.release()
            await session.close()
            raise HTTPException(502, f"Источник аудио вернул ошибку HTTP {upstream.status}")

        content_type = upstream.headers.get("content-type", "audio/mpeg")
        if _is_playlist(str(upstream.url), content_type):
            if download:
                upstream.release()
                await session.close()
                raise HTTPException(409, "Источник предоставляет потоковый плейлист, а не скачиваемый аудиофайл")
            try:
                playlist = await upstream.read()
                rewritten = _rewrite_hls_playlist(
                    playlist,
                    upstream_url=str(upstream.url),
                    proxy_base_url=f"{str(request.base_url).rstrip('/')}{settings.api_prefix}/media",
                    signer=media_signer,
                    headers=target.headers,
                )
            except UnsafeUrl as exc:
                raise HTTPException(502, "Источник аудио вернул некорректный HLS-плейлист") from exc
            finally:
                upstream.release()
                await session.close()
            return Response(
                content=rewritten,
                media_type=content_type.partition(";")[0].strip() or "application/vnd.apple.mpegurl",
                headers={
                    "Cache-Control": "private, no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )

        async def chunks():
            try:
                async for chunk in upstream.content.iter_chunked(64 * 1024):
                    yield chunk
            finally:
                upstream.release()
                await session.close()

        response_headers = {
            "Cache-Control": "private, no-store",
            "Accept-Ranges": "bytes",
            "X-Content-Type-Options": "nosniff",
        }
        if download:
            resolved_name = _download_filename(filename or "трек AWUN", content_type, str(upstream.url))
            response_headers["Content-Disposition"] = (
                f"attachment; filename=\"awun-audio.{resolved_name.rsplit('.', 1)[-1]}\"; "
                f"filename*=UTF-8''{quote(resolved_name)}"
            )
        for header in ("content-length", "content-range", "etag", "last-modified"):
            if value := upstream.headers.get(header):
                response_headers[header.title()] = value
        return StreamingResponse(
            chunks(),
            status_code=upstream.status,
            media_type=content_type,
            headers=response_headers,
        )

    return app


app = create_app()
