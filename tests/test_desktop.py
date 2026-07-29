from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_windows_builds_embed_the_awun_icon() -> None:
    batch = (ROOT / "build-windows.bat").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "build-windows-exe.yml").read_text(encoding="utf-8")
    spec = (ROOT / "AWUN.spec").read_text(encoding="utf-8")
    icon = ROOT / "desktop" / "assets" / "awun.ico"

    assert "AWUN.spec" in batch
    assert "AWUN.spec" in workflow
    assert '"desktop" / "assets" / "awun.ico"' in spec
    assert '"frontend"' in spec
    assert icon.read_bytes().startswith(b"\x00\x00\x01\x00")
    assert icon.stat().st_size > 10_000


def test_desktop_runs_the_backend_locally_without_render() -> None:
    launcher = (ROOT / "desktop" / "launcher.py").read_text(encoding="utf-8")
    requirements = (ROOT / "requirements-desktop.txt").read_text(encoding="utf-8")

    assert "LocalAwunServer" in launcher
    assert 'HOST = "127.0.0.1"' in launcher
    assert "create_app(settings)" in launcher
    assert "listener.bind((self.host, 0))" in launcher
    assert "?desktop=1&lang=ru" in launcher
    assert "DesktopStateBridge" in launcher
    assert 'os.getenv("APPDATA")' in launcher
    assert "onrender.com" not in launcher
    assert "-r requirements.txt" in requirements
