"""Reproductions for the 2026-10-20 audit; use only controlled local services."""
import asyncio
import json
import sys
from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestServer
from starlette.requests import Request

from backend.api.accounts import AccountGateway
from backend.api.main import _apply_security_headers, create_app
from backend.core.config import Settings
from backend.core.media import MediaSigner


def test_account_gateway_reads_a_json_response_split_between_network_packets():
    async def scenario():
        expected = {"library": [{"id": "a", "title": "Track"}] * 1000}
        raw = json.dumps(expected).encode()

        async def respond(request):
            response = web.StreamResponse(headers={"Content-Type": "application/json"})
            await response.prepare(request)
            await response.write(raw[:20])
            await asyncio.sleep(.05)
            await response.write(raw[20:])
            await response.write_eof()
            return response

        application = web.Application()
        application.router.add_get("/library", respond)
        async with TestServer(application) as server:
            gateway = AccountGateway(Settings(accounts_enabled=True, accounts_supabase_url="https://test.supabase.co", accounts_supabase_publishable_key="public-test", accounts_supabase_secret_key="server-test"))
            gateway.url = str(server.make_url("/")).rstrip("/")
            status, payload = await gateway.call("GET", "/library")
            assert status == 200
            assert payload == expected
    asyncio.run(scenario())


def test_media_proxy_sandboxes_untrusted_documents_without_changing_audio_bytes():
    async def scenario():
        settings = Settings(media_secret="audit-test-media-signing-key-32-characters")
        app = create_app(settings)
        payload = b'<script>localStorage.setItem("audit-injected","yes")</script>'

        class Content:
            async def iter_chunked(self, size):
                yield payload

        class Upstream:
            status = 200
            url = "https://media.example/file"
            headers = {"content-type": "text/html"}
            content = Content()
            def release(self):
                pass

        class Session:
            async def get(self, *args, **kwargs):
                return Upstream()

        app.state.media_session = Session()
        route = next(route for route in app.routes if route.path == "/api/v1/media/{token}")
        request = Request({"type":"http", "method":"GET", "scheme":"https", "path":"/api/v1/media/test", "headers":[(b"host", b"songvale.example")], "app":app})
        token = MediaSigner(settings.media_secret).sign(Upstream.url)
        response = _apply_security_headers(await route.endpoint(token, request, download=False, filename=None))
        assert "sandbox" in response.headers["content-security-policy"]
        assert "'unsafe-inline'" not in response.headers["content-security-policy"]
        assert b"".join([chunk async for chunk in response.body_iterator]) == payload
    asyncio.run(scenario())


def test_desktop_round_trips_owner_and_restore_guards_but_not_session_tokens(tmp_path):
    sys.modules.setdefault("webview", SimpleNamespace())
    from desktop.launcher import DesktopStateBridge
    bridge = DesktopStateBridge(tmp_path / "desktop-state.json")
    expected = {"awun-library": "[]", "songvale-account-owner-v1": "account-a", "songvale-backup-restore-pending-v1": "account-a", "songvale-account-sync-account-a": '{"revision":12,"dirty":true}', "songvale-source-preferences-v1": "[]", "songvale-transitions-v1": '{"crossfade":2}'}
    assert bridge.save_state(json.dumps({**expected, "songvale_access": "do-not-persist", "songvale_refresh": "do-not-persist"}))
    assert json.loads(bridge.load_state()) == expected


def test_public_playlist_import_reads_all_packets_and_enforces_actual_size(monkeypatch):
    import aiohttp
    import pytest
    from backend.importers import library_url
    pieces = [b'<html><script type="application/ld+json">', b'{"@type":"MusicRecording","name":"Track"}</script></html>']

    class Content:
        async def read(self, size):
            return pieces[0][:size]
        async def iter_chunked(self, size):
            for piece in pieces:
                yield piece

    class Upstream:
        status = 200
        headers = {}
        charset = "utf-8"
        url = "https://playlist.example/music"
        content = Content()
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass

    class Session:
        def __init__(self, **options):
            self.connector = options["connector"]
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            await self.connector.close()
        def get(self, *args, **kwargs):
            return Upstream()

    async def addresses(*args):
        return ["8.8.8.8"]
    monkeypatch.setattr(library_url, "_public_addresses", addresses)
    monkeypatch.setattr(library_url.aiohttp, "ClientSession", Session)
    async def scenario():
        raw, charset, url = await library_url._read_public_page(Upstream.url, headers={}, timeout=aiohttp.ClientTimeout(total=1))
        assert raw == b"".join(pieces)
        pieces[:] = [b"x" * 1_000_001, b"x" * 1_000_001]
        with pytest.raises(library_url.LibraryImportError, match="большая"):
            await library_url._read_public_page(Upstream.url, headers={}, timeout=aiohttp.ClientTimeout(total=1))
    asyncio.run(scenario())
