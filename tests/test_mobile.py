from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_mobile_builds_include_brand_assets_and_optional_mirror() -> None:
    android = (ROOT / "mobile" / "android" / "app" / "build.gradle").read_text(encoding="utf-8")
    manifest = (ROOT / "mobile" / "android" / "app" / "src" / "main" / "AndroidManifest.xml").read_text(encoding="utf-8")
    swift = (ROOT / "mobile" / "ios" / "AWUN" / "AWUNApp.swift").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "build-mobile.yml").read_text(encoding="utf-8")

    assert "AWUN_MIRROR_URL" in android
    assert '@mipmap/ic_launcher' in manifest
    assert "AWUNBrand" in swift and "didFailProvisionalNavigation" in swift
    assert "AWUN_MIRROR_URL" in workflow
    assert (ROOT / "mobile" / "android" / "app" / "src" / "main" / "res" / "mipmap-xxxhdpi" / "ic_launcher.png").stat().st_size > 300
    assert (ROOT / "mobile" / "ios" / "AWUN" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon-1024.png").stat().st_size > 5_000


def test_regional_mirror_does_not_proxy_youtube_media() -> None:
    config = (ROOT / "deploy" / "russia-mirror" / "nginx.conf").read_text(encoding="utf-8")
    readme = (ROOT / "deploy" / "russia-mirror" / "README.md").read_text(encoding="utf-8")

    assert "awun-api1.onrender.com" in config
    assert "youtube.com" not in config and "googlevideo.com" not in config
    assert "official embedded player" in readme
