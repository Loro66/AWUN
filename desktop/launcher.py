"""Автономная Windows-оболочка AWUN со встроенным локальным сервером."""

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

import uvicorn
import webview

from backend.api.main import create_app
from backend.core.config import Settings


HOST = "127.0.0.1"
STARTUP_TIMEOUT_SECONDS = 25
MAX_DESKTOP_STATE_BYTES = 4 * 1024 * 1024

SPLASH = """
<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;overflow:hidden;background:#10110e;color:#f1f1e9;font-family:Arial,sans-serif}
main{position:relative;height:100vh;display:grid;place-items:center;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:54px 54px}
main:before,main:after{content:"";position:absolute;border:1px solid rgba(183,255,25,.14);border-radius:50%;animation:orbit 8s ease-in-out infinite}
main:before{width:420px;height:420px;right:-130px;top:-110px}main:after{width:240px;height:240px;left:-80px;bottom:-60px;animation-direction:reverse}
section{position:relative;width:min(700px,82vw);padding:34px 0 0;border-top:1px solid #55584f}
section:before{content:"01 / ПРИЛОЖЕНИЕ";position:absolute;top:-24px;color:#55574f;font-size:7px;font-weight:900;letter-spacing:2px}
h1{margin:0;font-size:84px;font-style:italic;letter-spacing:-7px}h1 i{color:#b7ff19}
p{color:#8b8d82;font-size:9px;font-weight:800;letter-spacing:3px}.meta{display:flex;justify-content:space-between;margin-top:34px;color:#55574f;font-size:7px;font-weight:900;letter-spacing:1.5px}
.line{height:2px;margin-top:14px;background:#30322c;overflow:hidden}.line:after{content:"";display:block;width:34%;height:100%;background:#b7ff19;box-shadow:0 0 20px rgba(183,255,25,.4);animation:scan 1.2s ease-in-out infinite alternate}
@keyframes scan{to{transform:translateX(195%)}}@keyframes orbit{50%{transform:translate(-18px,14px) rotate(12deg)}}
</style></head><body><main><section><h1>AWUN<i>.</i></h1><p>ЗАПУСКАЕМ ЛОКАЛЬНЫЙ ПОИСК</p><div class="meta"><span>ЛОКАЛЬНАЯ ВЕРСИЯ / 1.8.0</span><span>ОДИН ПОИСК · ВСЯ МУЗЫКА</span></div><div class="line"></div></section></main></body></html>
"""


def startup_error_page(message: str) -> str:
    """Build a small Russian error page without exposing executable markup."""
    safe_message = html.escape(message)
    return f"""
    <!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
    body{{margin:0;background:#10110e;color:#f1f1e9;font-family:Arial,sans-serif}}
    main{{min-height:100vh;display:grid;place-items:center;padding:48px}}
    section{{max-width:720px;border-top:2px solid #ff5f57;padding-top:28px}}
    h1{{font-size:42px;margin:0 0 18px}}p{{color:#b8b9b0;line-height:1.6}}
    small{{display:block;margin-top:24px;color:#77796f}}
    </style></head><body><main><section><h1>Не удалось запустить AWUN</h1>
    <p>{safe_message}</p><small>Закрой приложение и запусти его ещё раз. Если ошибка повторяется, переустанови последнюю версию AWUN.</small>
    </section></main></body></html>
    """


class DesktopStateBridge:
    """Persist AWUN localStorage across launches that use different local ports."""

    def __init__(self, state_path: Path | None = None) -> None:
        if state_path is None:
            app_data = os.getenv("APPDATA")
            state_dir = Path(app_data) / "AWUN" if app_data else Path.home() / ".awun"
            state_path = state_dir / "desktop-state.json"
        self.state_path = state_path
        self._lock = threading.Lock()

    def load_state(self) -> str:
        with self._lock:
            try:
                raw = self.state_path.read_text(encoding="utf-8")
                data = json.loads(raw)
                if not isinstance(data, dict):
                    return "{}"
                safe = {
                    str(key): str(value)
                    for key, value in data.items()
                    if str(key).startswith("awun-")
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
            if str(key).startswith("awun-")
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
            app_version="1.8.0",
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
        window.load_url(f"{local_url}/?desktop=1&lang=ru")
    except Exception as exc:
        window.load_html(startup_error_page(str(exc)))


def main() -> None:
    runtime = LocalAwunServer()
    state_bridge = DesktopStateBridge()
    window = webview.create_window(
        "AWUN — вся музыка в одном поиске",
        html=SPLASH,
        width=1440,
        height=900,
        min_size=(960, 640),
        background_color="#10110e",
        confirm_close=False,
        js_api=state_bridge,
    )
    try:
        webview.start(open_local_app, (window, runtime), private_mode=False)
    finally:
        runtime.stop()


if __name__ == "__main__":
    main()
