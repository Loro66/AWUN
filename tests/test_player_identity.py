from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from desktop.player_identity import APP_USER_MODEL_ID, YOUTUBE_REFERER, identify_youtube_embed, register_process_identity


@pytest.mark.parametrize("host", ["www.youtube.com", "www.youtube-nocookie.com"])
@pytest.mark.parametrize("referer", [None, "", "http://127.0.0.1:43210/"])
def test_native_embed_identifies_the_registered_app(host, referer):
    headers = {"Accept": "text/html"}
    if referer is not None:
        headers["referer"] = referer
    identify_youtube_embed(SimpleNamespace(url=f"https://{host}/embed/video?enablejsapi=1", headers=headers))
    assert headers.get("referer", headers.get("Referer")) == YOUTUBE_REFERER
    assert headers["Accept"] == "text/html"


@pytest.mark.parametrize("url", [
    "https://www.youtube.com.evil.example/embed/video",
    "https://www.youtube.com@evil.example/embed/video",
    "http://www.youtube.com/embed/video",
    "https://www.youtube.com/watch?v=video",
    "https://www.youtube.com/iframe_api",
    "https://other.example/embed/video",
])
def test_unrelated_requests_keep_their_headers(url):
    headers = {"Referer": "http://127.0.0.1:43210/", "Authorization": "existing"}
    original = dict(headers)
    identify_youtube_embed(SimpleNamespace(url=url, headers=headers))
    assert headers == original


def test_internal_youtube_referrers_are_not_replaced():
    headers = {"Referer": "https://www.youtube.com/embed/parent"}
    identify_youtube_embed(SimpleNamespace(url="https://www.youtube.com/embed/child", headers=headers))
    assert headers["Referer"] == "https://www.youtube.com/embed/parent"


def test_windows_registers_the_same_identity_as_installer_shortcuts():
    setter = MagicMock(return_value=0)
    with patch("desktop.player_identity.sys.platform", "win32"), patch("desktop.player_identity.ctypes.windll", SimpleNamespace(shell32=SimpleNamespace(SetCurrentProcessExplicitAppUserModelID=setter)), create=True):
        register_process_identity()
    setter.assert_called_once_with(APP_USER_MODEL_ID)
    installer = (Path(__file__).resolve().parents[1] / "installer" / "AWUN.iss").read_text()
    assert installer.count(f'AppUserModelID: "{APP_USER_MODEL_ID}"') == 2
