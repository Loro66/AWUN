from pathlib import Path
import zipfile

import pytest

from desktop.region_compat import RegionCompatError, _validate_archive


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
    assert "regional_compat_status" in launcher
    assert "enable_regional_compat" in launcher
    assert "disable_regional_compat" in launcher
    assert "onrender.com" not in launcher
    assert "-r requirements.txt" in requirements


def test_region_compat_is_narrow_and_uses_verified_program_files_install() -> None:
    helper = (ROOT / "desktop" / "region_compat.py").read_text(encoding="utf-8")

    assert "AWUNRegionCompat" in helper
    assert "soundcloud.com" in helper
    assert "playback.media-streaming.soundcloud.cloud" in helper
    assert "youtube.com" in helper
    assert "googlevideo.com" in helper
    assert "ProgramFiles" in helper
    assert "Get-FileHash" in helper
    assert "SHA256" in helper
    assert "EncodedCommand" in helper
    assert "--hostlist=" in helper
    assert "--dpi-desync=" in helper
    assert "--ipset=" not in helper
    assert "GameFilter" not in helper


def test_region_compat_validates_zip_paths_and_expected_files(tmp_path: Path) -> None:
    valid = tmp_path / "valid.zip"
    with zipfile.ZipFile(valid, "w") as bundle:
        for name in (
            "bin/winws.exe",
            "bin/WinDivert.dll",
            "bin/WinDivert64.sys",
            "bin/quic_initial_www_google_com.bin",
            "bin/tls_clienthello_www_google_com.bin",
            "bin/tls_clienthello_4pda_to.bin",
            "LICENSE.txt",
        ):
            bundle.writestr(name, b"test")
    _validate_archive(valid)

    unsafe = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(unsafe, "w") as bundle:
        bundle.writestr("../escape.txt", b"test")
    with pytest.raises(RegionCompatError):
        _validate_archive(unsafe)
