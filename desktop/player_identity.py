"""Identify SONGVALE to the official YouTube player in native WebViews."""

import ctypes
import sys
from urllib.parse import urlparse


APP_USER_MODEL_ID = "com.loro66.songvale"
YOUTUBE_REFERER = f"https://{APP_USER_MODEL_ID}/"
YOUTUBE_EMBED_HOSTS = {"www.youtube.com", "www.youtube-nocookie.com"}


def register_process_identity() -> None:
    if sys.platform == "win32":
        setter = ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID
        setter.argtypes = [ctypes.c_wchar_p]
        setter.restype = ctypes.c_long
        setter(APP_USER_MODEL_ID)


def identify_youtube_embed(request) -> None:
    """Set the registered app identity on embed requests, preserving other traffic."""
    try:
        url = urlparse(request.url)
        if url.scheme != "https" or url.hostname not in YOUTUBE_EMBED_HOSTS or not url.path.startswith("/embed/"):
            return
        headers = request.headers
        key = next((name for name in headers if name.lower() == "referer"), "Referer")
        referer = urlparse(str(headers.get(key) or ""))
        if referer.hostname in YOUTUBE_EMBED_HOSTS:
            return
        headers[key] = YOUTUBE_REFERER
    except (AttributeError, TypeError, ValueError):
        return
