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
*{box-sizing:border-box}body{margin:0;background:#10110e;color:#f1f1e9;font-family:Arial,sans-serif}
main{height:100vh;display:grid;place-items:center;background:linear-gradient(120deg,transparent 60%,rgba(183,255,25,.04))}
section{width:min(620px,80vw);border-top:1px solid #35382f;padding-top:28px}
h1{margin:0;font-size:72px;font-style:italic;letter-spacing:-6px}h1 i{color:#b7ff19}
p{color:#8b8d82;font-size:10px;font-weight:800;letter-spacing:3px}.line{height:2px;margin-top:34px;background:#30322c;overflow:hidden}
.line:after{content:"";display:block;width:34%;height:100%;background:#b7ff19;animation:scan 1.2s ease-in-out infinite alternate}
@keyframes scan{to{transform:translateX(195%)}}
</style></head><body><main><section><h1>AWUN<i>.</i></h1><p>WAKING THE SEARCH NETWORK</p><div class="line"></div></section></main></body></html>
"""


def open_hosted_app(window: webview.Window) -> None:
    request = Request(f"{AWUN_URL.rstrip('/')}/health", headers={"User-Agent": "AWUN-Desktop/1.2"})
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
