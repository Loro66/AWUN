"""Device audio storage, enabled only by the native loopback launcher."""

import asyncio
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import tempfile
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse


MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_LIBRARY_BYTES = 5 * 1024 * 1024 * 1024
MAX_FILES = 1000
MIME_TYPES = {"audio/mpeg", "audio/mp4", "audio/flac", "audio/ogg", "audio/wav", "audio/aac", "audio/webm"}
FILE_ID = re.compile(r"^[a-f0-9]{64}$")


class LocalAudioStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.token = secrets.token_urlsafe(32)
        self.lock = asyncio.Lock()

    def config(self) -> dict:
        return {"token": self.token, "max_file_bytes": MAX_FILE_BYTES}

    @contextmanager
    def database(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        database = sqlite3.connect(self.directory / "library.sqlite3")
        try:
            with database:
                database.execute("CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, metadata TEXT NOT NULL)")
                yield database
        finally:
            database.close()

    def tracks(self) -> list[dict]:
        with self.database() as database:
            rows = database.execute("SELECT metadata FROM tracks ORDER BY rowid").fetchall()
        return [json.loads(row[0]) for row in rows]

    def metadata(self, file_id: str) -> dict:
        with self.database() as database:
            row = database.execute("SELECT metadata FROM tracks WHERE id = ?", (file_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Audio file not found")
        return json.loads(row[0])

    def save(self, track: dict) -> None:
        with self.database() as database:
            database.execute("INSERT INTO tracks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata", (track["file_id"], json.dumps(track, ensure_ascii=False)))

    def delete(self, file_id: str) -> None:
        path = self.file(file_id)
        pending = self.directory / f"delete-{secrets.token_hex(16)}"
        path.replace(pending)
        try:
            with self.database() as database:
                database.execute("DELETE FROM tracks WHERE id = ?", (file_id,))
        except (OSError, sqlite3.Error):
            pending.replace(path)
            raise
        pending.unlink(missing_ok=True)

    def authorize(self, request: Request, *, mutation: bool = False) -> None:
        candidate = request.headers.get("x-songvale-local-token") or request.query_params.get("token", "")
        if not candidate.isascii() or not secrets.compare_digest(candidate, self.token):
            raise HTTPException(403, "Local audio access denied")
        if mutation:
            origin = request.headers.get("origin")
            if origin != str(request.base_url).rstrip("/"):
                raise HTTPException(403, "Local audio origin rejected")

    def file(self, file_id: str) -> Path:
        if not FILE_ID.fullmatch(file_id):
            raise HTTPException(404, "Audio file not found")
        path = self.directory / file_id
        if path.is_symlink() or not path.is_file():
            raise HTTPException(404, "Audio file not found")
        return path


def register_local_audio_routes(app: FastAPI, store: LocalAudioStore | None) -> None:
    if store is None:
        return

    @app.get("/api/v1/local-audio", include_in_schema=False)
    async def list_audio(request: Request) -> dict:
        store.authorize(request)
        return {"tracks": await asyncio.to_thread(store.tracks)}

    @app.post("/api/v1/local-audio", include_in_schema=False)
    async def import_audio(request: Request) -> dict:
        store.authorize(request, mutation=True)
        mime = request.headers.get("content-type", "").split(";", 1)[0]
        if mime not in MIME_TYPES:
            raise HTTPException(415, "Unsupported audio format")
        header = request.headers.get("x-songvale-local-metadata", "{}")
        if len(header) > 16000:
            raise HTTPException(400, "Audio metadata is too large")
        try:
            supplied = json.loads(unquote(header))
            if not isinstance(supplied, dict):
                raise ValueError()
            metadata = {key: str(supplied.get(key) or "")[:200] for key in ("title", "artist", "album", "filename")}
            metadata["duration"] = max(0, min(86400, int(supplied.get("duration") or 0)))
            metadata["track_number"] = max(0, min(1000, int(supplied.get("track_number") or 0)))
        except (ValueError, TypeError, OverflowError) as error:
            raise HTTPException(400, "Invalid audio metadata") from error
        async with store.lock:
            store.directory.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            size = 0
            temporary: Path | None = None
            created = False
            try:
                with tempfile.NamedTemporaryFile(dir=store.directory, prefix="import-", delete=False) as output:
                    temporary = Path(output.name)
                    async for chunk in request.stream():
                        size += len(chunk)
                        if size > MAX_FILE_BYTES:
                            raise HTTPException(413, "Audio file exceeds 100 MiB")
                        digest.update(chunk)
                        await asyncio.to_thread(output.write, chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if not size:
                    raise HTTPException(400, "Empty audio file")
                file_id = digest.hexdigest()
                target = store.directory / file_id
                if target.is_symlink():
                    raise HTTPException(409, "Invalid local audio entry")
                if not target.exists():
                    files = [p for p in store.directory.iterdir() if FILE_ID.fullmatch(p.name) and p.is_file() and not p.is_symlink()]
                    if len(files) >= MAX_FILES or sum(p.stat().st_size for p in files) + size > MAX_LIBRARY_BYTES:
                        raise HTTPException(507, "Local audio storage is full")
                    temporary.replace(target)
                    temporary = None
                    created = True
                else:
                    try:
                        return {"track": store.metadata(file_id), "duplicate": True}
                    except HTTPException:
                        pass
                track = {**metadata, "file_id": file_id, "id": f"local_{file_id}", "source": "local", "stream_url": "", "stream_type": "audio", "mime": mime, "size": size, "quality": "LOCAL", "local_backend": "native"}
                try:
                    await asyncio.to_thread(store.save, track)
                except (OSError, sqlite3.Error) as error:
                    if created:
                        target.unlink(missing_ok=True)
                    raise HTTPException(507, "Local audio storage could not save the file") from error
                return {"track": track, "duplicate": False}
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)

    @app.get("/api/v1/local-audio/{file_id}", include_in_schema=False)
    async def read_audio(file_id: str, request: Request) -> FileResponse:
        store.authorize(request)
        metadata = await asyncio.to_thread(store.metadata, file_id)
        return FileResponse(store.file(file_id), media_type=metadata["mime"], headers={"Cache-Control": "no-store"})

    @app.patch("/api/v1/local-audio/{file_id}", include_in_schema=False)
    async def update_audio(file_id: str, request: Request) -> dict:
        store.authorize(request, mutation=True)
        if not FILE_ID.fullmatch(file_id):
            raise HTTPException(404, "Audio file not found")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 4000:
                raise HTTPException(400, "Audio metadata is too large")
        try:
            supplied = json.loads(raw)
            if not isinstance(supplied, dict):
                raise ValueError()
        except (ValueError, TypeError) as error:
            raise HTTPException(400, "Invalid audio metadata") from error
        async with store.lock:
            track = store.metadata(file_id)
            for key in ("title", "artist", "album"):
                if key in supplied:
                    track[key] = str(supplied[key] or "")[:200]
            await asyncio.to_thread(store.save, track)
        return {"track": track}

    @app.delete("/api/v1/local-audio/{file_id}", include_in_schema=False)
    async def delete_audio(file_id: str, request: Request) -> dict:
        store.authorize(request, mutation=True)
        async with store.lock:
            try:
                await asyncio.to_thread(store.delete, file_id)
            except (OSError, sqlite3.Error) as error:
                raise HTTPException(507, "Local audio file could not be removed") from error
        return {"deleted": True}
