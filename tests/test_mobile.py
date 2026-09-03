from pathlib import Path
import struct


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "mobile" / "android"
METADATA = ANDROID / "fastlane" / "metadata" / "android"


def png_size(path: Path) -> tuple[int, int]:
    payload = path.read_bytes()
    assert payload[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", payload[16:24])


def test_android_release_identity_targets_current_play_api() -> None:
    gradle = (ANDROID / "app" / "build.gradle").read_text(encoding="utf-8")
    root_gradle = (ANDROID / "build.gradle").read_text(encoding="utf-8")
    manifest = (ANDROID / "app" / "src" / "main" / "AndroidManifest.xml").read_text(encoding="utf-8")

    assert 'namespace "com.loro66.awun"' in gradle
    assert 'applicationId "com.loro66.awun"' in gradle
    assert "compileSdk 36" in gradle and "targetSdk 36" in gradle
    assert 'rootProject.file("../../VERSION")' in gradle
    assert "versionCode awunVersionCode" in gradle
    assert "versionName awunVersionName" in gradle
    assert 'version "8.13.2"' in root_gradle
    assert "WRITE_EXTERNAL_STORAGE" not in manifest
    assert "allowBackup=\"false\"" in manifest
    assert "usesCleartextTraffic=\"false\"" in manifest


def test_play_client_disables_downloads_and_background_playback() -> None:
    activity = (
        ANDROID
        / "app"
        / "src"
        / "main"
        / "java"
        / "com"
        / "loro66"
        / "awun"
        / "MainActivity.java"
    ).read_text(encoding="utf-8")
    gradle = (ANDROID / "app" / "build.gradle").read_text(encoding="utf-8")
    frontend = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    api = (ROOT / "backend" / "api" / "main.py").read_text(encoding="utf-8")
    policy = (ROOT / "backend" / "policy" / "client_capabilities.py").read_text(encoding="utf-8")

    assert "DownloadManager" not in activity and "DownloadListener" not in activity
    assert "setMediaPlaybackRequiresUserGesture(true)" in activity
    assert 'evaluateJavascript("window.awunApp?.pausePlayback?.()"' in activity
    assert "OnBackInvokedDispatcher.PRIORITY_DEFAULT" in activity
    assert "registerOnBackInvokedCallback" in activity
    assert "unregisterOnBackInvokedCallback" in activity
    assert '@SuppressLint("GestureBackNavigation")' in activity
    assert "BuildConfig.AWUN_CLIENT_ID" in activity and "android-play" in gradle
    assert "android-play" in frontend and "capabilities_for" in api
    assert '"android-play"' in policy
    assert "X-AWUN-Client" in frontend
    assert "track.download_url = None" in api
    assert "track.download_url&&!playStoreMode" in frontend


def test_android_shell_is_localized_secure_and_has_owned_fallback() -> None:
    strings_ru = (
        ANDROID / "app" / "src" / "main" / "res" / "values" / "strings.xml"
    ).read_text(encoding="utf-8")
    strings_en = (
        ANDROID / "app" / "src" / "main" / "res" / "values-en" / "strings.xml"
    ).read_text(encoding="utf-8")
    network = (
        ANDROID / "app" / "src" / "main" / "res" / "xml" / "network_security_config.xml"
    ).read_text(encoding="utf-8")
    gradle = (ANDROID / "app" / "build.gradle").read_text(encoding="utf-8")
    swift = (ROOT / "mobile" / "ios" / "AWUN" / "AWUNApp.swift").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "build-mobile.yml").read_text(encoding="utf-8")

    assert "AWUN пока недоступен" in strings_ru
    assert "AWUN is unavailable" in strings_en
    assert 'cleartextTrafficPermitted="false"' in network
    assert "AWUN_MIRROR_URL" in gradle
    assert "AWUNBrand" in swift and "didFailProvisionalNavigation" in swift
    assert "platforms;android-36" in workflow and 'gradle-version: "8.13"' in workflow
    assert png_size(
        ANDROID / "app" / "src" / "main" / "res" / "mipmap-xxxhdpi" / "ic_launcher.png"
    ) == (192, 192)


def test_play_workflow_builds_signed_aab_without_auto_publishing() -> None:
    workflow = (ROOT / ".github" / "workflows" / "build-google-play.yml").read_text(
        encoding="utf-8"
    )

    assert "workflow_dispatch:" in workflow
    assert "bundleRelease" in workflow and "app-release.aab" in workflow
    assert "PLAY_UPLOAD_KEYSTORE_BASE64" in workflow
    assert "PLAY_UPLOAD_STORE_PASSWORD" in workflow
    assert "jarsigner -verify" in workflow
    assert "upload-artifact@v4" in workflow
    assert "google-github-actions" not in workflow
    assert "play.google.com" not in workflow


def test_unsigned_play_workflow_builds_without_repository_secrets() -> None:
    workflow = (
        ROOT / ".github" / "workflows" / "build-google-play-unsigned.yml"
    ).read_text(encoding="utf-8")

    assert "bundleRelease" in workflow and "lintRelease" in workflow
    assert "AWUN-unsigned-${AWUN_VERSION_NAME}-${AWUN_VERSION_CODE}.aab" in workflow
    assert "PLAY_UPLOAD_KEYSTORE_BASE64" not in workflow
    assert "actions/upload-artifact@v4" in workflow
    assert "pull_request:" in workflow
    assert 'branches:\n      - main' in workflow


def test_render_blueprint_recreates_the_owned_release_url_without_secret_prompts() -> None:
    blueprint = (ROOT / "render.yaml").read_text(encoding="utf-8")

    assert "name: awun-1" in blueprint
    assert "plan: free" in blueprint
    assert "healthCheckPath: /health" in blueprint
    assert "renderSubdomainPolicy: enabled" in blueprint
    assert "autoDeployTrigger: commit" in blueprint
    assert "generateValue: true" in blueprint
    assert "sync: false" not in blueprint


def test_store_listing_text_and_assets_meet_play_dimensions() -> None:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    major, minor, patch = (int(part) for part in version.split(".")[:3])
    version_code = major * 1_000_000 + minor * 10_000 + patch * 100
    for locale in ("ru-RU", "en-US"):
        directory = METADATA / locale
        title = (directory / "title.txt").read_text(encoding="utf-8").strip()
        short = (directory / "short_description.txt").read_text(encoding="utf-8").strip()
        full = (directory / "full_description.txt").read_text(encoding="utf-8").strip()
        notes = (directory / "changelogs" / f"{version_code}.txt").read_text(encoding="utf-8").strip()

        assert 1 <= len(title) <= 30
        assert 1 <= len(short) <= 80
        assert 1 <= len(full) <= 4000
        assert 1 <= len(notes) <= 500
        assert png_size(directory / "images" / "icon.png") == (512, 512)
        assert png_size(directory / "images" / "featureGraphic.png") == (1024, 500)

        screenshots = sorted((directory / "images" / "phoneScreenshots").glob("*.png"))
        assert 2 <= len(screenshots) <= 8
        assert all(png_size(path) == (1080, 1920) for path in screenshots)


def test_privacy_support_and_play_declarations_are_present() -> None:
    api = (ROOT / "backend" / "api" / "main.py").read_text(encoding="utf-8")
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    privacy = (ROOT / "frontend" / "privacy.html").read_text(encoding="utf-8")
    checklist = (ANDROID / "play-store" / "RELEASE_CHECKLIST.md").read_text(encoding="utf-8")
    data_safety = (ANDROID / "play-store" / "DATA_SAFETY.md").read_text(encoding="utf-8")

    assert '@app.get("/privacy"' in api and '@app.get("/support"' in api
    assert 'href="/privacy"' in html and 'href="/support"' in html
    assert "https://github.com/Loro66/AWUN/issues" in privacy
    assert "mailto:" not in privacy
    assert "12 opted-in testers continuously for 14 days" in checklist
    assert "at least 18 years old" in checklist
    assert "In-app search history" in data_safety and "Processed ephemerally" in data_safety


def test_regional_mirror_does_not_proxy_youtube_media() -> None:
    config = (ROOT / "deploy" / "russia-mirror" / "nginx.conf").read_text(encoding="utf-8")
    readme = (ROOT / "deploy" / "russia-mirror" / "README.md").read_text(encoding="utf-8")

    assert "awun-1.onrender.com" in config
    assert "youtube.com" not in config and "googlevideo.com" not in config
    assert "official embedded player" in readme
