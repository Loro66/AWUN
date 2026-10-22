"""Автономная Windows-оболочка SONGVALE со встроенным локальным сервером."""

from __future__ import annotations

from dataclasses import dataclass, field
import html
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
from urllib.parse import quote

# The elevated supervisor has no server, browser or account/session state.
if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "--songvale-network-helper":
    from desktop.network_windows import helper_main
    raise SystemExit(helper_main(sys.argv[2:]))
if __name__ == "__main__" and sys.argv[1:] == ["--songvale-network-check"]:
    from desktop.network_runtime import check_packaged_runtime
    raise SystemExit(check_packaged_runtime())

# Acquire before importing the browser/backend: repeated shortcut clicks must
# activate the running player without starting another server or state writer.
from desktop.single_instance import SingleInstance

_instance = None
if __name__ == "__main__":
    from desktop.diagnostics import install_startup_diagnostics
    install_startup_diagnostics()
    _instance = SingleInstance()
    if not _instance.acquire():
        _instance.activate_existing()
        raise SystemExit(0)

import uvicorn
import webview

from backend.api.main import create_app
from backend.core.config import Settings
from backend.core.version import APP_VERSION
from desktop.controls import DesktopControls
from desktop.csp_bridge import configure_native_bridge
from desktop.persistence import DesktopStateStore
from desktop.updater import DesktopUpdater
from desktop.player_identity import identify_youtube_embed, register_process_identity
from desktop.network_access import DesktopNetworkAccess
from backend.library.local_audio import LocalAudioStore


HOST = "127.0.0.1"
STARTUP_TIMEOUT_SECONDS = 25
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


class DesktopStateBridge(DesktopStateStore):
    """Persist localStorage across launches and retain legacy AWUN data."""

    def __init__(self, state_path: Path | None = None) -> None:
        super().__init__(state_path)
        self._controls = None
        self._updater = None
        self._network = None
        self._local_audio = LocalAudioStore(self.state_path.parent / "local-music")

    def local_audio_config(self) -> dict:
        return self._local_audio.config()

    def desktop_status(self) -> dict:
        return self._controls.status() if self._controls else {"supported": False}

    def desktop_mini(self, enabled: bool, video: bool = False) -> bool:
        return bool(self._controls and self._controls.set_mini(enabled, video))

    def desktop_preferences(self, hotkeys: bool, close_to_tray: bool) -> bool:
        return bool(self._controls and self._controls.configure(hotkeys, close_to_tray))

    def desktop_command(self, action: str) -> bool:
        return bool(isinstance(action, str) and self._controls and self._controls.enqueue(action))

    def desktop_frontend_ready(self) -> bool:
        if not self._controls:
            return False
        self._controls.frontend_ready = True
        return True

    def desktop_close_ready(self) -> bool:
        return bool(self._controls and self._controls.finish_close())

    def desktop_close_cancel(self) -> bool:
        return bool(self._controls and self._controls.cancel_close())

    def desktop_update(self) -> bool:
        return bool(self._updater and self._updater.start())

    def desktop_update_status(self) -> dict:
        return self._updater.status() if self._updater else {"stage": "error"}

    def desktop_update_install(self) -> bool:
        if not self._updater or not self._controls or not self._updater.install():
            return False
        self._controls.finish_close()
        return True

    def desktop_network_status(self) -> dict:
        return self._network.status() if self._network else {"supported": False, "stage": "off"}

    def desktop_network_start(self, profile: str) -> bool:
        return bool(self._network and self._network.start(profile))

    def desktop_network_stop(self) -> bool:
        return bool(self._network and self._network.stop())

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
    local_audio_store: LocalAudioStore | None = None
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
            create_app(settings, local_audio_store=self.local_audio_store),
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
        query = "?desktop=1"
        if remote := remote_api_url():
            query += f"&fallback_api={quote(remote, safe='')}"
        window.load_url(f"{local_url}/{query}")
    except Exception as exc:
        from desktop.diagnostics import logger
        logger.exception("Local backend startup failed")
        window.load_html(startup_error_page(str(exc)))


def main() -> None:
    from desktop.diagnostics import logger
    register_process_identity()
    state_bridge = DesktopStateBridge()
    runtime = LocalAwunServer(local_audio_store=state_bridge._local_audio)
    window = webview.create_window(
        "SONGVALE — вся музыка сходится здесь",
        html=SPLASH,
        width=1440,
        height=900,
        min_size=(440, 300),
        background_color="#09120c",
        confirm_close=False,
        js_api=state_bridge,
    )
    configure_native_bridge(window)
    webview.settings["ALLOW_DOWNLOADS"] = True
    bundle_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    controls = DesktopControls(window, state_bridge.state_path.with_name("desktop-controls.json"), bundle_root / "desktop" / "assets" / "songvale.ico")
    state_bridge._controls = controls
    updater = DesktopUpdater(APP_VERSION)
    state_bridge._updater = updater
    network = DesktopNetworkAccess()
    state_bridge._network = network
    window.events.request_sent += identify_youtube_embed
    window.events.shown += controls.start
    window.events.before_load += controls.loading
    window.events.closing += controls.closing
    try:
        cache = Path(os.environ["LOCALAPPDATA"]) / "SONGVALE" if os.getenv("LOCALAPPDATA") else state_bridge.state_path.parent
        profile = cache / "WebView2"
        logger.info("Starting native WebView2 with a dedicated profile")
        webview.start(open_local_app, (window, runtime), private_mode=False,
                      gui="edgechromium" if os.name == "nt" else None, storage_path=str(profile))
    finally:
        network.close()
        controls.stop()
        updater.close()
        runtime.stop()
        if _instance:
            _instance.close()


if __name__ == "__main__":
    main()
