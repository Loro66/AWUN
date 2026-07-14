from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import aiohttp
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.core.config import Settings, get_settings
from backend.core.media import InvalidMediaToken, MediaSigner
from backend.core.models import SearchRequest, SearchResponse, SourceName
from backend.search.engine import SearchEngine
from backend.sources.factory import build_adapters


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    media_signer = MediaSigner(settings.media_secret, settings.media_token_ttl_seconds)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.search_engine = SearchEngine(
            build_adapters(settings),
            timeout_seconds=settings.search_timeout_seconds,
            max_limit=settings.max_limit,
        )
        yield
        await app.state.search_engine.close()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Federated music search across YouTube, SoundCloud and VK.",
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
            return FileResponse(frontend_dir / "index.html")

    @app.get("/health", tags=["system"])
    async def health(search_engine: Engine) -> dict[str, object]:
        return {"status": "ok", "sources": search_engine.available_sources}

    def proxied(response: SearchResponse, request: Request) -> SearchResponse:
        if not settings.media_proxy_enabled:
            return response
        base_url = str(request.base_url).rstrip("/")
        for track in response.tracks:
            if track.source == "youtube":
                continue
            token = media_signer.sign(track.stream_url, track.request_headers)
            media_url = f"{base_url}{settings.api_prefix}/media/{token}"
            track.stream_url = media_url
            if track.download_url:
                track.download_url = media_url
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
    ) -> SearchResponse:
        response = await search_engine.search(SearchRequest(query=q, limit=limit, sources=sources))
        return proxied(response, request)

    @app.get(f"{settings.api_prefix}/media/{{token}}", tags=["media"])
    async def media(token: str, request: Request) -> StreamingResponse:
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

        async def chunks():
            try:
                async for chunk in upstream.content.iter_chunked(64 * 1024):
                    yield chunk
            finally:
                upstream.release()
                await session.close()

        response_headers = {"Cache-Control": "private, no-store", "Accept-Ranges": "bytes"}
        for header in ("content-length", "content-range", "etag", "last-modified"):
            if value := upstream.headers.get(header):
                response_headers[header.title()] = value
        return StreamingResponse(
            chunks(),
            status_code=upstream.status,
            media_type=upstream.headers.get("content-type", "audio/mpeg"),
            headers=response_headers,
        )

    return app


app = create_app()
