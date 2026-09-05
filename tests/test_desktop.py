from pathlib import Path
import json
import sys
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]


def test_windows_builds_embed_the_awun_icon() -> None:
    batch = (ROOT / "build-windows.bat").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "build-windows-exe.yml").read_text(encoding="utf-8")
    spec = (ROOT / "AWUN.spec").read_text(encoding="utf-8")
    icon = ROOT / "desktop" / "assets" / "awun.ico"
    installer = (ROOT / "installer" / "AWUN.iss").read_text(encoding="utf-8")

    assert "AWUN.spec" in batch
    assert "AWUN.spec" in workflow
    assert '"desktop" / "assets" / "awun.ico"' in spec
    assert '"frontend"' in spec
    assert '"VERSION"' in spec
    assert icon.read_bytes().startswith(b"\x00\x00\x01\x00")
    assert icon.stat().st_size > 10_000
    assert "AWUN-Setup-x64" in workflow and "AWUN-Setup-x64" in installer
    assert "PrivilegesRequired=lowest" in installer


def test_desktop_uses_local_backend_before_the_free_remote_fallback() -> None:
    launcher = (ROOT / "desktop" / "launcher.py").read_text(encoding="utf-8")
    requirements = (ROOT / "requirements-desktop.txt").read_text(encoding="utf-8")

    assert "LocalAwunServer" in launcher
    assert 'HOST = "127.0.0.1"' in launcher
    assert "create_app(settings)" in launcher
    assert "listener.bind((self.host, 0))" in launcher
    assert "?desktop=1&lang=ru" in launcher
    assert "AWUN_REMOTE_API_URL" in launcher
    assert "remote-api.txt" in launcher
    assert "quote(remote, safe='')" in launcher
    assert "fallback_api=" in launcher
    assert "_normalize_remote_api_url" in launcher
    assert 'DEFAULT_REMOTE_API_URL = "https://awun-1.onrender.com"' in launcher
    assert "LOCAL_REMOTE_VALUES" in launcher
    assert "DesktopStateBridge" in launcher
    assert 'os.getenv("APPDATA")' in launcher
    assert "-r requirements.txt" in requirements


def test_frontend_can_use_an_explicit_remote_api_without_rewriting_local_assets() -> None:
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")

    assert "const apiBase=" in script
    assert "const fallbackApiBase=" in script
    assert "remoteRetryStatuses" in script
    assert "function apiUrl(input)" in script
    assert "const target=apiUrl(input)" in script
    assert "fetch(input,options)" in script
    assert "apiBase,fallbackApiBase,apiUrl" in script


def test_desktop_state_is_atomic_and_excludes_rebuildable_waveforms(tmp_path: Path) -> None:
    sys.modules.setdefault("webview", SimpleNamespace())
    from desktop.launcher import DesktopStateBridge

    bridge = DesktopStateBridge(tmp_path / "desktop-state.json")

    assert bridge.save_state(json.dumps({
        "awun-library": "[]",
        "awun-waveforms-v1": "large transient cache",
        "unrelated": "ignored",
    })) is True

    assert json.loads(bridge.load_state()) == {"awun-library": "[]"}
    assert not (tmp_path / "desktop-state.tmp").exists()
