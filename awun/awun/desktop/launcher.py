"""Lightweight Windows shell for the hosted AWUN beta."""

from __future__ import annotations

import os

import webview


AWUN_URL = os.getenv(
    "AWUN_DESKTOP_URL",
    "https://awun-music.nguyenkhoisv221.chatgpt.site",
)


def main() -> None:
    webview.create_window(
        "AWUN",
        AWUN_URL,
        width=1440,
        height=900,
        min_size=(960, 640),
        background_color="#f4f3ee",
        confirm_close=True,
    )
    webview.start(private_mode=False)


if __name__ == "__main__":
    main()

