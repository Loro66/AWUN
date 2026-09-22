from __future__ import annotations

import asyncio
from html.parser import HTMLParser
import ipaddress
import json
import socket
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

import aiohttp

from backend.core.models import LibraryImportEntry, LibraryImportResponse


class LibraryImportError(ValueError):
    pass


class _StructuredDataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self._in_json = False
        self._buffer: list[str] = []
        self.documents: list[Any] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): (value or "") for key, value in attrs}
        if tag.lower() == "title":
            self._in_title = True
        if tag.lower() == "script" and "ld+json" in values.get("type", "").lower():
            self._in_json = True
            self._buffer = []

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False
        if tag.lower() == "script" and self._in_json:
            self._in_json = False
            try:
                self.documents.append(json.loads("".join(self._buffer)))
            except (json.JSONDecodeError, TypeError):
                pass

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._in_json:
            self._buffer.append(data)


def _artist(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return str(value.get("name") or value.get("artist") or "").strip()
    if isinstance(value, list):
        return ", ".join(filter(None, (_artist(item) for item in value)))
    return ""


def structured_tracks(documents: list[Any], limit: int) -> list[LibraryImportEntry]:
    found: list[LibraryImportEntry] = []

    def visit(value: Any) -> None:
        if len(found) >= limit:
            return
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return
        kind = str(value.get("@type") or value.get("type") or "").lower()
        item = value.get("item") if kind == "listitem" else value
        if isinstance(item, dict):
            item_kind = str(item.get("@type") or item.get("type") or "").lower()
            title = str(item.get("name") or item.get("title") or "").strip()
            artist = _artist(item.get("byArtist") or item.get("artist") or item.get("creator"))
            if title and ("musicrecording" in item_kind or artist):
                url = item.get("url")
                image = item.get("image")
                if isinstance(image, dict):
                    image = image.get("url")
                found.append(LibraryImportEntry(artist=artist, title=title, external_url=url, thumbnail=image))
                return
        for key in ("track", "tracks", "itemListElement", "hasPart", "mainEntity", "@graph"):
            if key in value:
                visit(value[key])

    for document in documents:
        visit(document)
    unique: dict[tuple[str, str], LibraryImportEntry] = {}
    for track in found:
        unique[(track.artist.casefold(), track.title.casefold())] = track
    return list(unique.values())[:limit]


async def _public_addresses(hostname: str, port: int = 443) -> list[str]:
    if not hostname or hostname.lower() == "localhost":
        raise LibraryImportError("Можно переносить только публичные ссылки HTTPS.")
    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo,
            hostname,
            port,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
    except socket.gaierror as exc:
        raise LibraryImportError("Не удалось найти сервер плейлиста.") from exc
    public: list[str] = []
    for address in addresses:
        raw_ip = address[4][0].split("%", 1)[0]
        ip = ipaddress.ip_address(raw_ip)
        if not ip.is_global:
            raise LibraryImportError("Ссылки на приватную или локальную сеть запрещены.")
        normalized = str(ip)
        if normalized not in public:
            public.append(normalized)
    if not public:
        raise LibraryImportError("Не удалось найти публичный адрес сервера плейлиста.")
    return public


async def _public_host(hostname: str) -> None:
    await _public_addresses(hostname)


class _PinnedResolver(aiohttp.abc.AbstractResolver):
    """Resolve one already-validated host to the exact validated addresses."""

    def __init__(self, hostname: str, addresses: list[str]) -> None:
        self.hostname = hostname.rstrip(".").casefold()
        self.addresses = tuple(addresses)

    async def resolve(
        self,
        host: str,
        port: int = 0,
        family: socket.AddressFamily = socket.AF_UNSPEC,
    ) -> list[dict[str, Any]]:
        if host.rstrip(".").casefold() != self.hostname:
            raise OSError("Pinned resolver received an unexpected host")
        return [
            {
                "hostname": host,
                "host": address,
                "port": port,
                "family": socket.AF_INET6 if ":" in address else socket.AF_INET,
                "proto": socket.IPPROTO_TCP,
                "flags": socket.AI_NUMERICHOST,
            }
            for address in self.addresses
        ]

    async def close(self) -> None:
        return None


async def _read_public_page(
    url: str,
    *,
    headers: dict[str, str],
    timeout: aiohttp.ClientTimeout,
    max_redirects: int = 4,
) -> tuple[bytes, str, str]:
    """Fetch an HTTPS page while pinning every DNS result and redirect hop."""

    current = url
    for redirect_index in range(max_redirects + 1):
        parsed = urlparse(current)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise LibraryImportError("Плейлист перенаправил запрос на небезопасный адрес.")
        try:
            port = parsed.port
        except ValueError as exc:
            raise LibraryImportError("Ссылка плейлиста содержит некорректный порт.") from exc
        if port not in {None, 443}:
            raise LibraryImportError("Для переноса разрешены только HTTPS-ссылки на порту 443.")
        hostname = parsed.hostname or ""
        addresses = await _public_addresses(hostname, 443)
        connector = aiohttp.TCPConnector(
            resolver=_PinnedResolver(hostname, addresses),
            use_dns_cache=False,
            limit=1,
        )
        async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
            async with session.get(current, headers=headers, allow_redirects=False) as response:
                if response.status in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise LibraryImportError("Перенаправление плейлиста не содержит адрес.")
                    if redirect_index >= max_redirects:
                        raise LibraryImportError("Страница плейлиста создала слишком много перенаправлений.")
                    current = urljoin(str(response.url), location)
                    continue
                if response.status != 200:
                    raise LibraryImportError(f"Страница плейлиста вернула ошибку HTTP {response.status}.")
                if int(response.headers.get("content-length") or 0) > 2_000_000:
                    raise LibraryImportError("Страница плейлиста слишком большая для безопасного переноса.")
                raw = await response.content.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise LibraryImportError("Страница плейлиста слишком большая для безопасного переноса.")
                return raw, response.charset or "utf-8", str(response.url)
    raise LibraryImportError("Не удалось безопасно открыть страницу плейлиста.")


class LibraryUrlImporter:
    def __init__(self, youtube_api_key: str | None, timeout_seconds: float = 15.0) -> None:
        self.youtube_api_key = youtube_api_key
        self.timeout = aiohttp.ClientTimeout(total=timeout_seconds)

    async def import_url(self, url: str, max_tracks: int) -> LibraryImportResponse:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            raise LibraryImportError("Используй публичную HTTPS-ссылку на плейлист.")
        await _public_host(parsed.hostname or "")
        host = (parsed.hostname or "").lower()
        playlist_id = parse_qs(parsed.query).get("list", [""])[0]
        if playlist_id and host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}:
            return await self._youtube(url, playlist_id, max_tracks)
        return await self._structured_page(url, max_tracks)

    async def _youtube(self, source_url: str, playlist_id: str, limit: int) -> LibraryImportResponse:
        if not self.youtube_api_key:
            raise LibraryImportError("Для переноса плейлиста YouTube нужен локальный ключ AWUN_YOUTUBE_API_KEY.")
        tracks: list[LibraryImportEntry] = []
        token = ""
        title = None
        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            while len(tracks) < limit:
                params = {
                    "part": "snippet",
                    "playlistId": playlist_id,
                    "maxResults": min(50, limit - len(tracks)),
                    "key": self.youtube_api_key,
                }
                if token:
                    params["pageToken"] = token
                async with session.get("https://www.googleapis.com/youtube/v3/playlistItems", params=params) as response:
                    payload = await response.json(content_type=None)
                    if response.status != 200:
                        message = payload.get("error", {}).get("message", "YouTube отклонил запрос плейлиста.")
                        raise LibraryImportError(message)
                for item in payload.get("items", []):
                    snippet = item.get("snippet") or {}
                    video_id = (snippet.get("resourceId") or {}).get("videoId")
                    name = str(snippet.get("title") or "").strip()
                    if not video_id or name in {"Deleted video", "Private video"}:
                        continue
                    owner = str(snippet.get("videoOwnerChannelTitle") or snippet.get("channelTitle") or "").removesuffix(" - Topic")
                    thumbnails = snippet.get("thumbnails") or {}
                    thumbnail = (thumbnails.get("medium") or thumbnails.get("default") or {}).get("url")
                    tracks.append(LibraryImportEntry(artist=owner, title=name, source="youtube", external_id=video_id, external_url=f"https://www.youtube.com/watch?v={video_id}", thumbnail=thumbnail))
                token = str(payload.get("nextPageToken") or "")
                if not token:
                    break
            async with session.get("https://www.googleapis.com/youtube/v3/playlists", params={"part": "snippet", "id": playlist_id, "key": self.youtube_api_key}) as response:
                if response.status == 200:
                    payload = await response.json(content_type=None)
                    items = payload.get("items") or []
                    if items:
                        title = (items[0].get("snippet") or {}).get("title")
        return LibraryImportResponse(provider="youtube", title=title, source_url=source_url, tracks=tracks[:limit])

    async def _structured_page(self, url: str, limit: int) -> LibraryImportResponse:
        headers = {"User-Agent": "SONGVALE/2.0 public-playlist-importer (+https://github.com/Loro66/AWUN)", "Accept": "text/html,application/xhtml+xml,application/json;q=0.8"}
        raw, charset, final_url = await _read_public_page(
            url,
            headers=headers,
            timeout=self.timeout,
        )
        parser = _StructuredDataParser()
        parser.feed(raw.decode(charset, errors="replace"))
        tracks = structured_tracks(parser.documents, limit)
        if not tracks:
            host = (urlparse(final_url).hostname or "").lower()
            if host.endswith("music.yandex.ru"):
                raise LibraryImportError("Яндекс Музыка не отдаёт эту медиатеку через поддерживаемый публичный API. Загрузи экспорт в формате CSV, JSON, M3U или TXT.")
            raise LibraryImportError("Открытый список треков не найден. Попробуй официальную публичную ссылку или загрузи файл экспорта.")
        return LibraryImportResponse(provider="structured_web", title=parser.title.strip() or None, source_url=url, tracks=tracks)
