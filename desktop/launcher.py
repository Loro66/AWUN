"""Автономная Windows-оболочка SONGVALE со встроенным локальным сервером."""

from __future__ import annotations

from dataclasses import dataclass, field
import html
import json
import os
from pathlib import Path
import secrets
import socket
import threading
import time
from urllib.parse import quote

import uvicorn
import webview

from backend.api.main import create_app
from backend.core.config import Settings
from backend.core.version import APP_VERSION


HOST = "127.0.0.1"
STARTUP_TIMEOUT_SECONDS = 25
MAX_DESKTOP_STATE_BYTES = 4 * 1024 * 1024
TRANSIENT_DESKTOP_STATE_KEYS = {"awun-waveforms-v1"}
REMOTE_API_ENV = "SONGVALE_REMOTE_API_URL"
LEGACY_REMOTE_API_ENV = "AWUN_REMOTE_API_URL"
REMOTE_API_FILE = "remote-api.txt"
# SONGVALE's public Render deployment is a provider fallback. The embedded local
# backend always receives requests first so a healthy source never wakes or
# waits for the remote service.
DEFAULT_REMOTE_API_URL = "https://awun-1.onrender.com"
LOCAL_REMOTE_VALUES = {"local", "off", "disabled", "none"}

SPLASH = """
<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;overflow:hidden;background:#09120c;color:#f1f0e8;font-family:"Segoe UI Variable Display","Segoe UI",Arial,sans-serif}
main{position:relative;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 78% 18%,rgba(255,107,26,.13),transparent 34%),linear-gradient(145deg,#0d1a12,#071009)}
main:before{content:"";position:absolute;inset:22px;border:1px solid rgba(241,240,232,.08);border-radius:28px}
section{position:relative;width:min(720px,82vw);padding:36px;border:1px solid rgba(241,240,232,.12);border-radius:28px;background:rgba(5,13,8,.66);box-shadow:0 28px 90px rgba(0,0,0,.38)}
.brand{display:flex;align-items:center;gap:24px}.mark{width:92px;height:92px;flex:0 0 auto}h1{margin:0;font-size:54px;font-weight:680;line-height:1;letter-spacing:.15em}
p{margin:14px 0 0;color:#ff6b1a;font-size:9px;font-weight:750;letter-spacing:2.4px}.meta{display:flex;justify-content:space-between;margin-top:38px;color:#8c9a90;font-size:8px;font-weight:700;letter-spacing:1.3px}
.line{height:3px;margin-top:14px;border-radius:9px;background:#233128;overflow:hidden}.line:after{content:"";display:block;width:32%;height:100%;border-radius:9px;background:#ff6b1a;box-shadow:0 0 20px rgba(255,107,26,.42);animation:scan 1.2s ease-in-out infinite alternate}
@keyframes scan{to{transform:translateX(212%)}}
</style></head><body><main><section><div class="brand"><svg class="mark" viewBox="0 0 128 128" aria-hidden="true"><rect x="4" y="4" width="120" height="120" rx="30" fill="#09120c" stroke="#314338" stroke-width="4"/><g fill="#f1f0e8"><rect x="20" y="42" width="13" height="48" rx="6.5"/><rect x="39" y="29" width="13" height="72" rx="6.5"/><rect x="58" y="18" width="13" height="92" rx="6.5"/><rect x="77" y="29" width="13" height="72" rx="6.5"/><rect x="96" y="42" width="13" height="48" rx="6.5"/></g><path d="M18 52c15 7 23 18 39 23 20 7 31-13 53-23" fill="none" stroke="#ff6b1a" stroke-width="10" stroke-linecap="round"/></svg><div><h1>SONGVALE</h1><p>ВСЯ МУЗЫКА СХОДИТСЯ ЗДЕСЬ</p></div></div><div class="meta"><span>ЛОКАЛЬНАЯ ВЕРСИЯ / __AWUN_VERSION__</span><span>ЗАПУСКАЕМ ПОИСК</span></div><div class="line"></div></section></main></body></html>
""".replace("__AWUN_VERSION__", APP_VERSION)


def startup_error_page(message: str) -> str:
    """Build a small Russian error page without exposing executable markup."""
    safe_message = html.escape(message)
    return f"""
    <!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    body{{margin:0;background:#09120c;color:#f1f0e8;font-family:"Segoe UI",Arial,sans-serif}}
    main{{min-height:100vh;display:grid;place-items:center;padding:48px}}
    section{{max-width:720px;border-top:2px solid #ff5f57;padding-top:28px}}
    h1{{font-size:42px;margin:0 0 18px}}p{{color:#b8b9b0;line-height:1.6}}
    small{{display:block;margin-top:24px;color:#77796f}}
    </style></head><body><main><section><h1>Не удалось запустить SONGVALE</h1>
    <p>{safe_message}</p><small>Закрой приложение и запусти его ещё раз. Если ошибка повторяется, переустанови последнюю версию SONGVALE.</small>
    </section></main></body></html>
    """


class DesktopStateBridge:
    """Persist localStorage across launches and retain legacy AWUN data."""

    def __init__(self, state_path: Path | None = None) -> None:
        self.legacy_state_path: Path | None = None
        if state_path is None:
            app_data = os.getenv("APPDATA")
            state_dir = Path(app_data) / "SONGVALE" if app_data else Path.home() / ".songvale"
            state_path = state_dir / "desktop-state.json"
            self.legacy_state_path = (
                Path(app_data) / "AWUN" / "desktop-state.json"
                if app_data
                else Path.home() / ".awun" / "desktop-state.json"
            )
        self.state_path = state_path
        self._lock = threading.Lock()

    def load_state(self) -> str:
        with self._lock:
            try:
                source = self.state_path
                if not source.exists() and self.legacy_state_path and self.legacy_state_path.exists():
                    source = self.legacy_state_path
                raw = source.read_text(encoding="utf-8")
                data = json.loads(raw)
                if not isinstance(data, dict):
                    return "{}"
                safe = {
                    str(key): str(value)
                    for key, value in data.items()
                    if str(key).startswith("awun-") and str(key) not in TRANSIENT_DESKTOP_STATE_KEYS
                }
                return json.dumps(safe, ensure_ascii=False)
            except (OSError, ValueError, TypeError):
                return "{}"

    def save_state(self, payload: str) -> bool:
        if not isinstance(payload, str) or len(payload.encode("utf-8")) > MAX_DESKTOP_STATE_BYTES:
            return False
        try:
            data = json.loads(payload)
        except (ValueError, TypeError):
            return False
        if not isinstance(data, dict):
            return False
        safe = {
            str(key): str(value)
            for key, value in data.items()
            if str(key).startswith("awun-") and str(key) not in TRANSIENT_DESKTOP_STATE_KEYS
        }
        encoded = json.dumps(safe, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_DESKTOP_STATE_BYTES:
            return False
        with self._lock:
            try:
                self.state_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.state_path.with_suffix(".tmp")
                temporary.write_text(encoded, encoding="utf-8")
                temporary.replace(self.state_path)
                return True
            except OSError:
                return False


def _normalize_remote_api_url(value: str | None) -> str | None:
    """Accept only an explicit HTTPS API origin (or loopback HTTP for testing)."""

    candidate = str(value or "").strip()
    if not candidate:
        return None
    try:
        from urllib.parse import urlsplit, urlunsplit

        parts = urlsplit(candidate)
        host = (parts.hostname or "").casefold()
    except ValueError:
        return None
    if parts.scheme.casefold() not in {"http", "https"} or not parts.netloc:
        return None
    if parts.username or parts.password or parts.query or parts.fragment or not host:
        return None
    if parts.scheme.casefold() == "http" and host not in {"localhost", "127.0.0.1", "::1"}:
        return None
    path = parts.path.rstrip("/")
    return urlunsplit((parts.scheme.casefold(), parts.netloc, path, "", ""))


def remote_api_url() -> str | None:
    """Return the configured endpoint, or the public fallback by default.

    Setting ``SONGVALE_REMOTE_API_URL=local`` (or the legacy AWUN variable)
    (or putting ``local`` in the
    settings file) opts out and keeps all provider requests on the computer.
    Any other invalid value falls back to the built-in endpoint so a typo does
    not silently disable the network workaround.
    """

    value = os.getenv(REMOTE_API_ENV, "") or os.getenv(LEGACY_REMOTE_API_ENV, "")
    if not value:
        app_data = os.getenv("APPDATA")
        if app_data:
            try:
                current_file = Path(app_data) / "SONGVALE" / REMOTE_API_FILE
                legacy_file = Path(app_data) / "AWUN" / REMOTE_API_FILE
                value = (current_file if current_file.exists() else legacy_file).read_text(encoding="utf-8")
            except OSError:
                value = ""
    value = str(value or "").strip()
    if value.casefold() in LOCAL_REMOTE_VALUES:
        return None
    return _normalize_remote_api_url(value) or DEFAULT_REMOTE_API_URL


@dataclass
class LocalAwunServer:
    """Run FastAPI on an ephemeral loopback port for the lifetime of the window."""

    host: str = HOST
    server: uvicorn.Server | None = field(default=None, init=False)
    thread: threading.Thread | None = field(default=None, init=False)
    listener: socket.socket | None = field(default=None, init=False)
    url: str = field(default="", init=False)

    def start(self, timeout: float = STARTUP_TIMEOUT_SECONDS) -> str:
        if self.thread and self.thread.is_alive():
            return self.url

        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind((self.host, 0))
        self.listener.listen(128)
        port = int(self.listener.getsockname()[1])
        self.url = f"http://{self.host}:{port}"

        settings = Settings(
            app_version=APP_VERSION,
            media_secret=secrets.token_urlsafe(32),
            cors_origins=[self.url],
        )
        config = uvicorn.Config(
            create_app(settings),
            host=self.host,
            port=port,
            loop="asyncio",
            http="h11",
            log_level="warning",
            access_log=False,
        )
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(
            target=self.server.run,
            kwargs={"sockets": [self.listener]},
            name="awun-local-server",
            daemon=True,
        )
        self.thread.start()

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.server.started:
                return self.url
            if not self.thread.is_alive():
                break
            time.sleep(0.05)
        self.stop()
        raise RuntimeError("Локальный сервер не ответил вовремя.")

    def stop(self) -> None:
        if self.server:
            self.server.should_exit = True
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=6)
        if self.server and self.thread and self.thread.is_alive():
            self.server.force_exit = True
            self.thread.join(timeout=2)
        if self.listener:
            try:
                self.listener.close()
            except OSError:
                pass


def open_local_app(window: webview.Window, runtime: LocalAwunServer) -> None:
    try:
        local_url = runtime.start()
        query = "?desktop=1&lang=ru"
        if remote := remote_api_url():
            query += f"&fallback_api={quote(remote, safe='')}"
        window.load_url(f"{local_url}/{query}")
    except Exception as exc:
        window.load_html(startup_error_page(str(exc)))


def main() -> None:
    runtime = LocalAwunServer()
    state_bridge = DesktopStateBridge()
    window = webview.create_window(
        "SONGVALE — вся музыка сходится здесь",
        html=SPLASH,
        width=1440,
        height=900,
        min_size=(960, 640),
        background_color="#09120c",
        confirm_close=False,
        js_api=state_bridge,
    )
    try:
        webview.start(open_local_app, (window, runtime), private_mode=False)
    finally:
        runtime.stop()


if __name__ == "__main__":
    main()
