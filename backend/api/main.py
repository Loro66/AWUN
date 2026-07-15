from contextlib import asynccontextmanager
from pathlib import Path
import re
from typing import Annotated
from urllib.parse import quote, urlencode, urlparse

import aiohttp
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.core.config import Settings, get_settings
from backend.core.media import InvalidMediaToken, MediaSigner
from backend.core.models import SearchRequest, SearchResponse, SourceName
from backend.core.regions import REGION_NAMES, RegionName
from backend.search.engine import SearchEngine
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


def _safe_filename_stem(value: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return (value or "AWUN track")[:120].rstrip(" .")


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


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    media_signer = MediaSigner(settings.media_secret, settings.media_token_ttl_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.search_engine = SearchEngine(
            build_adapters(settings),
            timeout_seconds=settings.search_timeout_seconds,
            max_limit=settings.max_limit,
            enricher=build_enricher(settings),
        )
        yield
        await app.state.search_engine.close()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Region-aware federated music search across YouTube, SoundCloud, "
            "Audius, Jamendo and Internet Archive, enriched by MusicBrainz."
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
    if frontend_dir.is_dir():
        app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

        @app.get("/", include_in_schema=False)
        async def frontend() -> FileResponse:
            return FileResponse(frontend_dir / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/health", tags=["system"])
    async def health(search_engine: Engine) -> dict[str, object]:
        return {
            "status": "ok",
            "version": settings.app_version,
            "sources": search_engine.available_sources,
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
            },
        }

    def proxied(response: SearchResponse, request: Request) -> SearchResponse:
        if not settings.media_proxy_enabled:
            return response
        base_url = str(request.base_url).rstrip("/")
        for track in response.tracks:
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

    @app.post(f"{settings.api_prefix}/search", response_model=SearchResponse, tags=["search"])
    async def search(body: SearchRequest, request: Request, search_engine: Engine) -> SearchResponse:
        if body.limit > settings.max_limit:
            raise HTTPException(422, f"limit must not exceed {settings.max_limit}")
        return proxied(await search_engine.search(body), request)

    @app.get(f"{settings.api_prefix}/search", response_model=SearchResponse, tags=["search"])
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

    @app.get(f"{settings.api_prefix}/media/{{token}}", tags=["media"])
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

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
            "Accept": "*/*",
            **target.headers,
        }
        if byte_range := request.headers.get("range"):
            headers["Range"] = byte_range

        session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=None, connect=settings.media_connect_timeout_seconds)
        )
        try:
            upstream = await session.get(target.url, headers=headers, allow_redirects=True)
        except (aiohttp.ClientError, TimeoutError) as exc:
            await session.close()
            raise HTTPException(502, "Media source is unavailable") from exc

        if upstream.status not in {200, 206}:
            upstream.release()
            await session.close()
            raise HTTPException(502, f"Media source returned HTTP {upstream.status}")

        content_type = upstream.headers.get("content-type", "audio/mpeg")
        if download and _is_playlist(str(upstream.url), content_type):
            upstream.release()
            await session.close()
            raise HTTPException(409, "This source provides a streaming playlist, not a downloadable audio file")

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
            resolved_name = _download_filename(filename or "AWUN track", content_type, str(upstream.url))
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
