"""Lightweight Windows shell for the hosted AWUN beta."""

from __future__ import annotations

import os
from urllib.request import Request, urlopen

import webview


AWUN_URL = os.getenv(
    "AWUN_DESKTOP_URL",
    "https://awun-api1.onrender.com",
)

SPLASH = """
<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;overflow:hidden;background:#10110e;color:#f1f1e9;font-family:Arial,sans-serif}
main{position:relative;height:100vh;display:grid;place-items:center;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);background-size:54px 54px}
main:before,main:after{content:"";position:absolute;border:1px solid rgba(183,255,25,.14);border-radius:50%;animation:orbit 8s ease-in-out infinite}
main:before{width:420px;height:420px;right:-130px;top:-110px}main:after{width:240px;height:240px;left:-80px;bottom:-60px;animation-direction:reverse}
section{position:relative;width:min(700px,82vw);padding:34px 0 0;border-top:1px solid #55584f}
section:before{content:"01 / DESKTOP";position:absolute;top:-24px;color:#55574f;font-size:7px;font-weight:900;letter-spacing:2px}
h1{margin:0;font-size:84px;font-style:italic;letter-spacing:-7px}h1 i{color:#b7ff19}
p{color:#8b8d82;font-size:9px;font-weight:800;letter-spacing:3px}.meta{display:flex;justify-content:space-between;margin-top:34px;color:#55574f;font-size:7px;font-weight:900;letter-spacing:1.5px}
.line{height:2px;margin-top:14px;background:#30322c;overflow:hidden}.line:after{content:"";display:block;width:34%;height:100%;background:#b7ff19;box-shadow:0 0 20px rgba(183,255,25,.4);animation:scan 1.2s ease-in-out infinite alternate}
@keyframes scan{to{transform:translateX(195%)}}@keyframes orbit{50%{transform:translate(-18px,14px) rotate(12deg)}}
</style></head><body><main><section><h1>AWUN<i>.</i></h1><p>WAKING THE SEARCH NETWORK</p><div class="meta"><span>PUBLIC BETA / 1.5</span><span>ONE SEARCH · EVERY SOUND</span></div><div class="line"></div></section></main></body></html>
"""


def open_hosted_app(window: webview.Window) -> None:
    request = Request(f"{AWUN_URL.rstrip('/')}/health", headers={"User-Agent": "AWUN-Desktop/1.5"})
    try:
        with urlopen(request, timeout=70):
            pass
    except Exception:
        # Let the hosted page show its own offline state if the wake-up request fails.
        pass
    window.load_url(AWUN_URL)


def main() -> None:
    window = webview.create_window(
        "AWUN — one search, every sound",
        html=SPLASH,
        width=1440,
        height=900,
        min_size=(960, 640),
        background_color="#10110e",
        confirm_close=True,
    )
    webview.start(open_hosted_app, (window,), private_mode=False)


if __name__ == "__main__":
    main()
