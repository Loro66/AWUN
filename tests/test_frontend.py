from html.parser import HTMLParser
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


class _IdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        element_id = dict(attrs).get("id")
        if element_id:
            self.ids.append(element_id)


def test_visual_controls_have_unique_ids() -> None:
    parser = _IdParser()
    parser.feed((ROOT / "frontend" / "index.html").read_text(encoding="utf-8"))

    assert len(parser.ids) == len(set(parser.ids))
    assert {
        "themeButton",
        "searchNavButton",
        "themePanel",
        "motionToggle",
        "decorToggle",
        "telemetryClock",
        "regionSelect",
        "limitSelect",
        "importButton",
        "importPanel",
        "libraryFile",
        "importText",
        "decorValue",
        "densityToggle",
        "densityValue",
        "repeatMode",
        "flowButton",
        "flowPanel",
        "flowStart",
        "flowLike",
        "flowDislike",
        "flowBlockArtist",
        "flowLanguage",
        "flowEra",
        "importUrl",
        "importUrlSubmit",
    }.issubset(parser.ids)


def test_region_archive_and_catalog_controls_are_wired() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")

    assert 'data-source="internet_archive"' in html
    assert all(f'value="{region}"' in html for region in ("AUTO", "CIS", "EUROPE", "USA", "LATAM", "ASIA", "GLOBAL"))
    assert "catalog_links" in script
    assert "yandex_music" in script
    assert "parseImportedLibrary" in script
    assert "resultLimits=[30,60,100]" in script
    assert "navigator.language" in script


def test_every_visual_theme_has_css_and_javascript_metadata() -> None:
    styles = (ROOT / "frontend" / "styles.css").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")

    for theme in ("black", "white", "acid", "ultraviolet", "cobalt", "ember"):
        assert f'data-theme="{theme}"' in styles or theme == "acid"
        assert f"{theme}:{{labelKey:" in script


def test_frontend_assets_share_cache_version() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    api = (ROOT / "backend" / "api" / "main.py").read_text(encoding="utf-8")

    style_version = re.search(r'/static/styles\.css\?v=([\d.]+)', html)
    script_version = re.search(r'/static/app\.js\?v=([\d.]+)', html)
    flow_version = re.search(r'/static/flow\.js\?v=([\d.]+)', html)

    assert style_version is not None
    assert script_version is not None
    assert flow_version is not None
    assert style_version.group(1) == script_version.group(1)
    assert style_version.group(1) == flow_version.group(1)
    assert "CacheControlledStaticFiles" in api and "max-age=31536000, immutable" in api


def test_identity_minimal_mode_and_track_stories_are_wired() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    styles = (ROOT / "frontend" / "styles.css").read_text(encoding="utf-8")
    mark = (ROOT / "frontend" / "awun-mark.svg").read_text(encoding="utf-8")

    assert '/static/brand/awun-logo-white.png' in html
    assert 'data-i18n="interface"' in html and "state.decor==='minimal'" in script
    assert 'viewBox="0 0 64 64"' in mark
    assert "/api/v1/track-details" in script
    assert "awun-line-comments-v1" in script
    assert "t('trackStory')" in script
    assert 'html[data-decor="minimal"] .source-row' in styles
    assert ".lyric-line" in styles and ".line-comment-form" in styles
    assert "awun-logo-black.png" in styles
    assert 'data-density="compact"' in styles and 'data-density="airy"' in styles


def test_repeat_modes_are_persistent_and_handle_track_endings() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")

    assert 'id="repeatMode"' in html
    assert "awun-repeat-mode" in script
    assert "['off','all','one']" in script
    assert "handleTrackEnded" in script
    assert "YT.PlayerState.ENDED)handleTrackEnded()" in script
    assert "addEventListener('ended',handleTrackEnded)" in script


def test_flow_recommendations_are_local_persistent_and_feedback_driven() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "flow.js").read_text(encoding="utf-8")
    app = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    styles = (ROOT / "frontend" / "styles.css").read_text(encoding="utf-8")

    assert 'data-i18n="personalRadio"' in html and 'data-i18n="wave"' in html
    assert all(
        f'data-i18n="{value}"' in html
        for value in ("familiar", "balanced", "newOnly", "mood", "activity", "language", "era")
    )
    assert "awun-wave-profile-v2" in script
    assert "candidateScore" in script and "rankCandidates" in script
    assert all(signal in script for signal in ("'play'", "'skip'", "'listen30'", "'complete'", "'like'", "'dislike'"))
    assert "primeLocalFlow" in script and "fast:true" in script and "/api/v1/search" in script
    assert "Promise.allSettled" not in script
    assert "window.awunApp" in app and "emitAwun('play'" in app and "emitAwun('complete'" in app
    assert ".flow-panel" in styles and ".flow-feedback.active" in styles


def test_public_url_import_is_automatic_and_account_safe() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    api = (ROOT / "backend" / "api" / "main.py").read_text(encoding="utf-8")

    assert 'id="importUrl"' in html and 'data-i18n="publicPlaylistLink"' in html
    assert "/api/v1/library/import-url" in script and "matchAndSaveImported" in script
    assert 'f"{settings.api_prefix}/library/import-url"' in api


def test_installable_pwa_is_wired() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    manifest = (ROOT / "frontend" / "manifest.webmanifest").read_text(encoding="utf-8")
    worker = (ROOT / "frontend" / "service-worker.js").read_text(encoding="utf-8")
    bridge = (ROOT / "frontend" / "desktop-bridge.js").read_text(encoding="utf-8")

    assert 'rel="manifest"' in html and 'id="installButton"' in html
    assert "beforeinstallprompt" in script and "serviceWorker.register('/service-worker.js')" in script
    assert '"display": "standalone"' in manifest and '"start_url": "/"' in manifest
    assert "awun-shell-1.8.9" in worker and "startsWith('/api/')" in worker
    assert "hls.light.min.js" in worker
    assert "startsWith('/static/')" in worker and "cached||fetch" in worker
    assert "/static/desktop-bridge.js" in html and "desktop-bridge.js" in worker
    assert "pywebviewready" in bridge and "save_state" in bridge and "load_state" in bridge


def test_nocturne_redesign_and_vinyl_player_are_wired() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    forest = (ROOT / "frontend" / "forest.css").read_text(encoding="utf-8")
    background = ROOT / "frontend" / "brand" / "burg-eltz-jan-kohl.webp"
    source = ROOT / "frontend" / "brand" / "burg-eltz-jan-kohl.source.txt"

    assert background.is_file() and background.stat().st_size > 200_000
    assert source.is_file() and "unsplash.com/photos/m8RNISlL2HQ" in source.read_text(encoding="utf-8")
    assert '/static/forest.css?v=20260830.1' in html
    assert 'class="turntable"' in html and 'class="vinyl-monogram"' in html and 'class="player-console"' in html
    assert 'id="player" class="player" hidden' in html
    assert 'id="searchNavButton" class="library search-nav active"' in html and 'aria-pressed="true"' in html
    assert "tonearm" not in html
    assert "--vinyl-cover" in script and "has-artwork" in script and "track-enter" in script
    assert "const activateTrack=" in script
    assert "/static/brand/burg-eltz-jan-kohl.webp" in forest
    assert ".player.is-playing .player-artwork" in forest and "nocturneVinylReveal" in forest and "nocturneControlsReveal" in forest
    assert "@media(min-width:1100px)" in forest and "--awun-nav" in forest and "--awun-queue" in forest
    assert "grid-template-columns:var(--awun-nav) var(--awun-queue) minmax(0,1fr)" in forest
    assert "left:calc(var(--awun-nav) + var(--awun-queue))" in forest
    assert "--vinyl-size:clamp(720px,54vw,1020px)" in forest
    assert "right:clamp(-510px,-27vw,-360px)" in forest
    assert ".player[hidden]{display:none}" in forest and ".empty-guide{margin:" in forest
    assert ".idle-stage" in forest and ".player.track-swap" in forest


def test_soundcloud_hls_playback_is_wired() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    hls = ROOT / "frontend" / "hls.light.min.js"
    license_file = ROOT / "frontend" / "hls.js.LICENSE.md"

    assert 'src="/static/hls.light.min.js?v=20260830.1"' in html
    assert "track.source==='soundcloud'" in script
    assert "window.Hls" in script and "MANIFEST_PARSED" in script
    assert hls.is_file() and hls.stat().st_size > 300_000
    assert license_file.is_file() and "Apache License" in license_file.read_text(encoding="utf-8")


def test_listener_first_onboarding_and_language_switch_are_wired() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    i18n = (ROOT / "frontend" / "i18n.js").read_text(encoding="utf-8")
    styles = (ROOT / "frontend" / "styles.css").read_text(encoding="utf-8")

    assert 'id="languageButton"' in html and 'id="advancedSearch"' in html
    assert 'id="emptyGuide"' in html and "data-search-suggestion" in html
    assert "awunI18n" in script
    assert "awun-language" in i18n and "dictionaries" in i18n
    assert ".empty-guide" in styles and ".advanced-search" in styles and ".suggestions" in styles


def test_russian_translation_covers_static_and_dynamic_ui() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    flow = (ROOT / "frontend" / "flow.js").read_text(encoding="utf-8")
    i18n = (ROOT / "frontend" / "i18n.js").read_text(encoding="utf-8")

    assert '<html lang="ru">' in html
    assert "/static/i18n.js" in html
    assert "AWUN — один поиск, вся музыка" in html
    assert "const t=(key,values={})" in script
    assert "window.awunI18n.t" in flow
    assert "ИЩЕМ ВО ВСЕХ ИСТОЧНИКАХ" in i18n
    assert "ПЕРЕНОС МЕДИАТЕКИ" in i18n
    assert "МОЯ ВОЛНА остановлена" in i18n
