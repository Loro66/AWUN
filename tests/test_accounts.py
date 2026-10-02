"""Account isolation, optimistic revisions, and CSRF protections without a live provider."""

import asyncio
import json
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Response
from starlette.requests import Request

from backend.api.accounts import AccountGateway, _library_payload, _origin, register_account_routes
from backend.core.config import Settings


USER_ID = "d6d229bf-e421-4ddc-898f-1aac3eadac43"
CONFIG = {
    "accounts_enabled": True,
    "accounts_supabase_url": "https://project.supabase.co",
    "accounts_supabase_publishable_key": "sb_publishable_fake",
    "accounts_supabase_secret_key": "sb_secret_fake",
}


def request(method="GET", body=None, *, origin="https://songvale.example"):
    raw = json.dumps(body).encode() if body is not None else b""
    delivered = False

    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": raw, "more_body": False}
        return {"type": "http.request", "body": b"", "more_body": False}

    headers = [(b"host", b"songvale.example"), (b"cookie", b"songvale_access=user-jwt")]
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    scope = {"type": "http", "method": method, "scheme": "https", "path": "/api/v1/account/library", "query_string": b"", "headers": headers, "server": ("songvale.example", 443)}
    return Request(scope, receive=receive)


def endpoint(path, method):
    app = FastAPI()
    register_account_routes(app, Settings(**CONFIG))
    return next(route.endpoint for route in app.routes if route.path == path and method in route.methods)


def test_invalid_provider_configuration_stays_disabled():
    assert not AccountGateway(Settings(**{**CONFIG, "accounts_enabled": False})).enabled
    for url in ("http://project.supabase.co", "https://project.supabase.co.evil.net", "https://project.supabase.co/?redirect=evil", "https://user@project.supabase.co"):
        assert not AccountGateway(Settings(**{**CONFIG, "accounts_supabase_url": url})).enabled
    assert AccountGateway(Settings(**CONFIG)).enabled


def test_library_payload_strips_ephemeral_stream_credentials():
    track = {"source": "audius", "id": "a1", "title": "Song", "artist": "Artist", "stream_url": "https://host/?secret=token", "download_url": "https://host/?secret=other"}
    clean = _library_payload({"library": [track], "playlists": [{"id": "p", "name": "Music", "items": [{"position": 0, "track": track}]}]})
    assert clean["library"][0] == {"source": "audius", "id": "a1", "title": "Song", "artist": "Artist"}
    assert clean["playlists"][0]["items"][0]["track"] == clean["library"][0]


def test_cross_origin_mutations_are_blocked():
    for origin in (None, "https://attacker.example", "http://songvale.example"):
        try:
            _origin(request("PUT", origin=origin))
        except HTTPException as exc:
            assert exc.status_code == 403
        else:
            raise AssertionError("Cross-origin mutation was accepted")


def test_account_write_uses_user_jwt_and_rejects_stale_revision():
    save = endpoint("/api/v1/account/library", "PUT")
    calls = []
    async def fake_call(self, method, path, **kwargs):
        calls.append((method, path, kwargs))
        if path == "/auth/v1/user":
            return 200, {"id": USER_ID, "email": "listener@example.com"}
        if method == "POST":
            return 201, [{"revision": 1}]
        return 200, []

    track = {"source": "audius", "id": "a1", "title": "Song", "artist": "Artist", "stream_url": "https://host/?secret=token"}
    async def scenario():
        payload = {"revision": 0, "library": [track], "playlists": []}
        assert await save(request("PUT", payload), Response()) == {"revision": 1}
        try:
            await save(request("PUT", {**payload, "revision": 1}), Response())
        except HTTPException as exc:
            assert exc.status_code == 409
        else:
            raise AssertionError("Stale write was accepted")

    with patch.object(AccountGateway, "call", fake_call):
        asyncio.run(scenario())
    assert calls[0][2]["token"] == "user-jwt"
    assert calls[1][2]["token"] == "user-jwt"
    assert calls[1][2]["data"]["user_id"] == USER_ID
    assert "stream_url" not in calls[1][2]["data"]["library"][0]
    assert f"user_id=eq.{USER_ID}" in calls[3][1]
    assert "revision=eq.1" in calls[3][1]


def test_account_deletion_rechecks_password_and_uses_server_secret():
    delete = endpoint("/api/v1/account/delete", "POST")
    from backend.api.accounts import Credentials
    calls = []
    async def fake_call(self, method, path, **kwargs):
        calls.append((method, path, kwargs))
        if path == "/auth/v1/user":
            return 200, {"id": USER_ID, "email": "listener@example.com"}
        if path.startswith("/auth/v1/token"):
            return 200, {"user": {"id": USER_ID}}
        return 204, None

    with patch.object(AccountGateway, "call", fake_call):
        response = Response()
        assert asyncio.run(delete(Credentials(email="listener@example.com", password="long-secure-password"), request("POST"), response)) == {"ok": True}
    assert calls[-1][0] == "DELETE"
    assert calls[-1][2]["admin"] is True
    assert "songvale_access=" in response.headers["set-cookie"]


def test_recovery_requires_valid_link_token_before_password_change():
    complete = endpoint("/api/v1/account/recover/complete", "POST")
    from backend.api.accounts import RecoveryComplete
    calls = []
    async def fake_call(self, method, path, **kwargs):
        calls.append((method, path, kwargs))
        if method == "GET":
            return 200, {"id": USER_ID}
        return 200, {"id": USER_ID}

    with patch.object(AccountGateway, "call", fake_call):
        result = asyncio.run(complete(RecoveryComplete(access_token="recovery-token-for-tests", password="new-strong-password"), request("POST"), Response()))
    assert result == {"ok": True}
    assert calls == [
        ("GET", "/auth/v1/user", {"token": "recovery-token-for-tests"}),
        ("PUT", "/auth/v1/user", {"data": {"password": "new-strong-password"}, "token": "recovery-token-for-tests"}),
    ]

    async def expired(self, method, path, **kwargs):
        return 401, None
    with patch.object(AccountGateway, "call", expired):
        try:
            asyncio.run(complete(RecoveryComplete(access_token="expired-recovery-token", password="new-strong-password"), request("POST"), Response()))
        except HTTPException as exc:
            assert exc.status_code == 401
        else:
            raise AssertionError("Expired recovery link changed the password")
