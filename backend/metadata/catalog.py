"""Artist and album metadata. Catalog listings do not imply playable audio."""

import asyncio
from typing import Any
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query, Request

from backend.reliability.ttl_cache import TTLCache
from backend.search.enrichment import MusicBrainzEnricher


def credit_name(credits: list) -> str:
    return "".join(str(c.get("name") or c.get("artist", {}).get("name", "")) + str(c.get("joinphrase", "")) for c in credits if isinstance(c, dict)).strip()


class CatalogService:
    def __init__(self, client: MusicBrainzEnricher | None) -> None:
        self.client = client
        self.cache: TTLCache[tuple, dict] = TTLCache(ttl_seconds=3600, max_size=256)
        self.pending: dict[tuple, asyncio.Task] = {}

    async def json(self, path: str, **params: str) -> dict[str, Any]:
        if self.client is None:
            raise HTTPException(503, "Catalog metadata is disabled")
        key = (path, tuple(sorted(params.items())))
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        if key not in self.pending:
            if len(self.pending) >= 8:
                raise HTTPException(503, "Catalog is busy; retry shortly")
            async def fetch() -> dict:
                try:
                    data = await asyncio.wait_for(self.client.get_json(path, {**params, "fmt": "json"}), timeout=15)
                    self.cache.set(key, data)
                    return data
                finally:
                    self.pending.pop(key, None)
            self.pending[key] = asyncio.create_task(fetch())
        try:
            return await asyncio.shield(self.pending[key])
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(502, "Catalog metadata is temporarily unavailable") from error

    async def close(self) -> None:
        tasks = list(self.pending.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def artists(self, name: str) -> dict:
        escaped = name.replace("\\", "\\\\").replace('"', '\\"')
        data = await self.json("artist/", query=f'artist:"{escaped}"', limit="8")
        return {"artists": [{"id": a["id"], "name": a.get("name", ""), "description": a.get("disambiguation", ""), "country": a.get("country", ""), "type": a.get("type", ""), "score": int(a.get("score") or 0)} for a in data.get("artists", []) if isinstance(a, dict) and a.get("id")]}

    async def albums(self, artist_id: str, offset: int) -> dict:
        artist = await self.json(f"artist/{artist_id}")
        data = await self.json("release-group/", artist=artist_id, limit="50", offset=str(offset))
        albums = [{"id": a["id"], "title": a.get("title", ""), "artist": artist.get("name", ""), "date": a.get("first-release-date", ""), "type": a.get("primary-type", ""), "secondary_types": a.get("secondary-types", []), "artwork": f'https://coverartarchive.org/release-group/{a["id"]}/front-250'} for a in data.get("release-groups", []) if isinstance(a, dict) and a.get("id")]
        return {"artist": {"id": artist_id, "name": artist.get("name", ""), "description": artist.get("disambiguation", "")}, "albums": albums, "offset": offset, "total": data.get("release-group-count", len(albums))}

    async def album(self, album_id: str) -> dict:
        group = await self.json(f"release-group/{album_id}", inc="artist-credits+releases")
        releases = [r for r in group.get("releases", []) if isinstance(r, dict) and r.get("id")]
        releases.sort(key=lambda r: (r.get("status") != "Official", r.get("date") or "9999", r["id"]))
        if not releases:
            raise HTTPException(404, "No edition with a track list was found")
        edition = await self.json(f'release/{releases[0]["id"]}', inc="recordings+artist-credits")
        artist = credit_name(group.get("artist-credit", []))
        tracks = []
        for disc in edition.get("media", []):
            for entry in disc.get("tracks", []):
                recording = entry.get("recording") or {}
                tracks.append({"id": recording.get("id") or entry.get("id", ""), "title": entry.get("title") or recording.get("title", ""), "artist": credit_name(entry.get("artist-credit") or recording.get("artist-credit") or []) or artist, "duration": max(0, round(int(entry.get("length") or recording.get("length") or 0) / 1000)), "disc": disc.get("position", 1), "position": entry.get("position", len(tracks) + 1)})
        if not tracks:
            raise HTTPException(404, "The edition has no track list")
        if len(tracks) > 1000:
            raise HTTPException(422, "This edition exceeds the 1000-track album limit")
        return {"id": album_id, "title": group.get("title", ""), "artist": artist, "date": group.get("first-release-date", ""), "type": group.get("primary-type", ""), "release_id": edition.get("id"), "edition": edition.get("date", ""), "artwork": f"https://coverartarchive.org/release-group/{album_id}/front-250", "tracks": tracks, "metadata_source": "musicbrainz"}


def register_catalog_routes(app: FastAPI, prefix: str) -> None:
    @app.get(f"{prefix}/catalog/artists", tags=["каталог"])
    async def artists(request: Request, name: str = Query(min_length=1, max_length=200)) -> dict:
        name = name.strip()
        if not name:
            raise HTTPException(400, "Artist name is required")
        return await request.app.state.catalog.artists(name)

    @app.get(f"{prefix}/catalog/artists/{{artist_id}}/albums", tags=["каталог"])
    async def albums(artist_id: UUID, request: Request, offset: int = Query(default=0, ge=0, le=10000)) -> dict:
        return await request.app.state.catalog.albums(str(artist_id), offset)

    @app.get(f"{prefix}/catalog/albums/{{album_id}}", tags=["каталог"])
    async def album(album_id: UUID, request: Request) -> dict:
        return await request.app.state.catalog.album(str(album_id))
