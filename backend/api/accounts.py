"""Same-origin account gateway for Supabase Auth and user-scoped library rows."""

import json
import re
from urllib.parse import quote, urlsplit

import aiohttp
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from backend.core.config import Settings


ACCESS_COOKIE = "songvale_access"
REFRESH_COOKIE = "songvale_refresh"
MAX_STATE_BYTES = 4 * 1024 * 1024
TRACK_FIELDS = ("source", "id", "title", "artist", "duration", "quality", "thumbnail", "external_url", "catalog_links", "import_origin")


class Credentials(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=12, max_length=128)


class RecoveryRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class RecoveryComplete(BaseModel):
    access_token: str = Field(min_length=20, max_length=4096)
    password: str = Field(min_length=12, max_length=128)


def _email(value: str) -> str:
    value = value.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise HTTPException(422, "Enter a valid email address")
    return value


def _origin(request: Request) -> None:
    origin = request.headers.get("origin", "")
    host = request.headers.get("host", "")
    expected_scheme = "http" if host.startswith(("localhost:", "127.0.0.1:")) else "https"
    if origin != f"{expected_scheme}://{host}":
        raise HTTPException(403, "Cross-origin account request blocked")


def _cookies(response: Response, payload: dict, request: Request) -> None:
    secure = not request.url.hostname in {"localhost", "127.0.0.1"}
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    if not isinstance(access, str) or not isinstance(refresh, str) or not access or not refresh:
        raise HTTPException(502, "Account session unavailable")
    lifetime = max(60, min(int(payload.get("expires_in") or 3600), 3600))
    for name, value, max_age in ((ACCESS_COOKIE, access, lifetime), (REFRESH_COOKIE, refresh, 30 * 86400)):
        response.set_cookie(name, value, max_age=max_age, secure=secure, httponly=True, samesite="strict", path="/api/v1/account")
    response.headers["Cache-Control"] = "no-store"


def _clear_cookies(response: Response) -> None:
    for name in (ACCESS_COOKIE, REFRESH_COOKIE):
        response.delete_cookie(name, path="/api/v1/account")
    response.headers["Cache-Control"] = "no-store"


def _track(value: object) -> dict:
    if not isinstance(value, dict):
        raise HTTPException(422, "Invalid track")
    result = {key: value[key] for key in TRACK_FIELDS if key in value}
    if not all(isinstance(result.get(key), str) and 0 < len(result[key]) <= limit for key, limit in (("source", 40), ("id", 200), ("title", 300), ("artist", 300))):
        raise HTTPException(422, "Invalid track metadata")
    for key in ("quality", "thumbnail", "external_url", "import_origin"):
        if key in result and (not isinstance(result[key], str) or len(result[key]) > 1000):
            raise HTTPException(422, "Invalid track metadata")
    if "duration" in result and (not isinstance(result["duration"], (int, float)) or not 0 <= result["duration"] <= 86400):
        raise HTTPException(422, "Invalid track duration")
    if "catalog_links" in result:
        links = result["catalog_links"]
        if not isinstance(links, dict) or len(links) > 10 or any(not isinstance(k, str) or not isinstance(v, str) or len(k) > 40 or len(v) > 1000 for k, v in links.items()):
            raise HTTPException(422, "Invalid track links")
    return result


def _library_payload(data: object) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("library"), list) or not isinstance(data.get("playlists"), list):
        raise HTTPException(422, "Invalid library")
    if len(data["library"]) > 1500 or len(data["playlists"]) > 25:
        raise HTTPException(422, "Library limit exceeded")
    library = [_track(track) for track in data["library"]]
    playlists = []
    for entry in data["playlists"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not 0 < len(entry["id"]) <= 100 or not isinstance(entry.get("name"), str) or not 0 < len(entry["name"]) <= 60:
            raise HTTPException(422, "Invalid playlist")
        items = entry.get("items")
        if not isinstance(items, list) or len(items) > 1000:
            raise HTTPException(422, "Invalid playlist items")
        clean_items = []
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("position"), int) or not 0 <= item["position"] < 100000:
                raise HTTPException(422, "Invalid playlist order")
            clean_items.append({"position": item["position"], "track": _track(item.get("track"))})
        import_keys = entry.get("importKeys", [])
        if not isinstance(import_keys, list) or len(import_keys) > 1000 or any(not isinstance(key, str) or len(key) > 500 for key in import_keys):
            raise HTTPException(422, "Invalid playlist metadata")
        playlists.append({"id": entry["id"], "name": entry["name"], "items": clean_items, "importKeys": import_keys})
    return {"library": library, "playlists": playlists}


class AccountGateway:
    def __init__(self, settings: Settings):
        url = (settings.accounts_supabase_url or "").rstrip("/")
        parsed = urlsplit(url)
        self.enabled = bool(settings.accounts_enabled and parsed.scheme == "https" and parsed.hostname and parsed.hostname.endswith(".supabase.co") and not (parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path) and settings.accounts_supabase_publishable_key and settings.accounts_supabase_secret_key)
        self.url = url
        self.key = settings.accounts_supabase_publishable_key or ""
        self.secret = settings.accounts_supabase_secret_key or ""

    async def call(self, method: str, path: str, *, data: object = None, token: str = "", admin: bool = False, prefer: str = "") -> tuple[int, object]:
        if not self.enabled:
            raise HTTPException(503, "Accounts are not configured")
        headers = {"apikey": self.secret if admin else self.key, "Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if prefer:
            headers["Prefer"] = prefer
        try:
            timeout = aiohttp.ClientTimeout(total=12)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.request(method, self.url + path, headers=headers, json=data) as response:
                    if response.content_length and response.content_length > MAX_STATE_BYTES + 4096:
                        raise HTTPException(502, "Account service returned too much data")
                    raw = await response.content.read(MAX_STATE_BYTES + 4097)
                    if len(raw) > MAX_STATE_BYTES + 4096:
                        raise HTTPException(502, "Account service returned too much data")
                    return response.status, json.loads(raw) if raw else None
        except (aiohttp.ClientError, TimeoutError, ValueError) as exc:
            raise HTTPException(502, "Account service unavailable") from exc

    async def user(self, request: Request, response: Response) -> tuple[dict, str]:
        access = request.cookies.get(ACCESS_COOKIE, "")
        if access:
            status, user = await self.call("GET", "/auth/v1/user", token=access)
            if status == 200 and isinstance(user, dict) and user.get("id"):
                return user, access
        refresh = request.cookies.get(REFRESH_COOKIE, "")
        if refresh:
            status, payload = await self.call("POST", "/auth/v1/token?grant_type=refresh_token", data={"refresh_token": refresh})
            if status == 200 and isinstance(payload, dict):
                _cookies(response, payload, request)
                access = payload["access_token"]
                status, user = await self.call("GET", "/auth/v1/user", token=access)
                if status == 200 and isinstance(user, dict) and user.get("id"):
                    return user, access
        _clear_cookies(response)
        raise HTTPException(401, "Sign in again")


def register_account_routes(app: FastAPI, settings: Settings) -> None:
    gateway = AccountGateway(settings)

    @app.get("/api/v1/account/config", tags=["account"])
    async def account_config() -> dict:
        return {"enabled": gateway.enabled}

    @app.post("/api/v1/account/signup", tags=["account"])
    async def account_signup(credentials: Credentials, request: Request, response: Response) -> dict:
        _origin(request)
        status, payload = await gateway.call("POST", "/auth/v1/signup", data={"email": _email(credentials.email), "password": credentials.password})
        if status >= 400:
            raise HTTPException(400, "Could not create account")
        if isinstance(payload, dict) and payload.get("access_token"):
            _cookies(response, payload, request)
            return {"pending": False}
        return {"pending": True}

    @app.post("/api/v1/account/login", tags=["account"])
    async def account_login(credentials: Credentials, request: Request, response: Response) -> dict:
        _origin(request)
        status, payload = await gateway.call("POST", "/auth/v1/token?grant_type=password", data={"email": _email(credentials.email), "password": credentials.password})
        if status != 200 or not isinstance(payload, dict):
            raise HTTPException(401, "Invalid credentials or unverified email")
        _cookies(response, payload, request)
        return {"email": payload.get("user", {}).get("email", "")}

    @app.post("/api/v1/account/recover", tags=["account"])
    async def account_recover(details: RecoveryRequest, request: Request) -> dict:
        _origin(request)
        status, _ = await gateway.call("POST", "/auth/v1/recover", data={"email": _email(details.email)})
        if status not in (200, 204):
            raise HTTPException(502, "Could not send recovery email")
        return {"ok": True}

    @app.post("/api/v1/account/recover/complete", tags=["account"])
    async def account_recovery_complete(details: RecoveryComplete, request: Request, response: Response) -> dict:
        _origin(request)
        status, user = await gateway.call("GET", "/auth/v1/user", token=details.access_token)
        if status != 200 or not isinstance(user, dict) or not user.get("id"):
            raise HTTPException(401, "Recovery link expired")
        status, _ = await gateway.call("PUT", "/auth/v1/user", data={"password": details.password}, token=details.access_token)
        if status != 200:
            raise HTTPException(400, "Could not update password")
        _clear_cookies(response)
        return {"ok": True}

    @app.get("/api/v1/account/session", tags=["account"])
    async def account_session(request: Request, response: Response) -> dict:
        user, _ = await gateway.user(request, response)
        response.headers["Cache-Control"] = "no-store"
        return {"id": user["id"], "email": user.get("email", "")}

    @app.get("/api/v1/account/library", tags=["account"])
    async def account_library(request: Request, response: Response) -> dict:
        user, access = await gateway.user(request, response)
        status, rows = await gateway.call("GET", "/rest/v1/songvale_library?select=revision,library,playlists&user_id=eq." + quote(user["id"], safe=""), token=access)
        if status != 200 or not isinstance(rows, list):
            raise HTTPException(502, "Could not load library")
        response.headers["Cache-Control"] = "no-store"
        return rows[0] if rows else {"revision": 0, "library": [], "playlists": []}

    @app.put("/api/v1/account/library", tags=["account"])
    async def account_save_library(request: Request, response: Response) -> dict:
        _origin(request)
        try:
            declared_size = int(request.headers.get("content-length") or 0)
        except ValueError as exc:
            raise HTTPException(400, "Invalid Content-Length") from exc
        if declared_size > MAX_STATE_BYTES:
            raise HTTPException(413, "Library too large")
        chunks = bytearray()
        async for chunk in request.stream():
            chunks.extend(chunk)
            if len(chunks) > MAX_STATE_BYTES:
                raise HTTPException(413, "Library too large")
        try:
            body = json.loads(chunks)
        except ValueError as exc:
            raise HTTPException(422, "Invalid library") from exc
        revision = body.get("revision") if isinstance(body, dict) else None
        if not isinstance(revision, int) or isinstance(revision, bool) or not 0 <= revision < 2**31:
            raise HTTPException(422, "Invalid library revision")
        clean = _library_payload(body)
        user, access = await gateway.user(request, response)
        row = {**clean, "revision": revision + 1}
        if revision == 0:
            path, method = "/rest/v1/songvale_library?select=revision", "POST"
            row["user_id"] = user["id"]
        else:
            path = "/rest/v1/songvale_library?select=revision&user_id=eq." + quote(user["id"], safe="") + "&revision=eq." + str(revision)
            method = "PATCH"
        status, rows = await gateway.call(method, path, data=row, token=access, prefer="return=representation")
        if status == 409 or status in (200, 201, 204) and rows == []:
            raise HTTPException(409, "Library changed on another device")
        if status not in (200, 201) or not isinstance(rows, list) or len(rows) != 1:
            raise HTTPException(502, "Could not save library")
        response.headers["Cache-Control"] = "no-store"
        return {"revision": rows[0]["revision"]}

    @app.post("/api/v1/account/logout", tags=["account"])
    async def account_logout(request: Request, response: Response) -> dict:
        _origin(request)
        access = request.cookies.get(ACCESS_COOKIE, "")
        if access and gateway.enabled:
            try:
                await gateway.call("POST", "/auth/v1/logout", token=access)
            except HTTPException:
                pass  # Clear this browser's session even if the provider is down.
        _clear_cookies(response)
        return {"ok": True}

    @app.post("/api/v1/account/delete", tags=["account"])
    async def account_delete(credentials: Credentials, request: Request, response: Response) -> dict:
        _origin(request)
        user, _ = await gateway.user(request, response)
        if _email(credentials.email) != user.get("email", "").lower():
            raise HTTPException(403, "Account confirmation failed")
        status, verified = await gateway.call("POST", "/auth/v1/token?grant_type=password", data={"email": credentials.email, "password": credentials.password})
        if status != 200 or not isinstance(verified, dict) or verified.get("user", {}).get("id") != user["id"]:
            raise HTTPException(403, "Account confirmation failed")
        status, _ = await gateway.call("DELETE", "/auth/v1/admin/users/" + quote(user["id"], safe=""), admin=True)
        if status not in (200, 204):
            raise HTTPException(502, "Could not delete account")
        _clear_cookies(response)
        return {"ok": True}
