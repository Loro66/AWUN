from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_windows_builds_embed_the_awun_icon() -> None:
    batch = (ROOT / "build-windows.bat").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "build-windows-exe.yml").read_text(encoding="utf-8")
    icon = ROOT / "desktop" / "assets" / "awun.ico"

    assert "--icon desktop\\assets\\awun.ico" in batch
    assert "--icon desktop/assets/awun.ico" in workflow
    assert icon.read_bytes().startswith(b"\x00\x00\x01\x00")
    assert icon.stat().st_size > 10_000
