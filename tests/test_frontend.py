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
    assert all(f"<option>{region}</option>" in html for region in ("AUTO", "CIS", "EUROPE", "USA", "LATAM", "ASIA", "GLOBAL"))
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
        assert f"{theme}:{{label:" in script


def test_frontend_assets_share_cache_version() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    style_version = re.search(r'/static/styles\.css\?v=([\d.]+)', html)
    script_version = re.search(r'/static/app\.js\?v=([\d.]+)', html)
    flow_version = re.search(r'/static/flow\.js\?v=([\d.]+)', html)

    assert style_version is not None
    assert script_version is not None
    assert flow_version is not None
    assert style_version.group(1) == script_version.group(1)
    assert style_version.group(1) == flow_version.group(1)


def test_identity_minimal_mode_and_track_stories_are_wired() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    styles = (ROOT / "frontend" / "styles.css").read_text(encoding="utf-8")
    mark = (ROOT / "frontend" / "awun-mark.svg").read_text(encoding="utf-8")

    assert '/static/brand/awun-logo-white.png' in html
    assert 'INTERFACE' in html and 'MINIMAL' in html
    assert 'viewBox="0 0 64 64"' in mark
    assert "/api/v1/track-details" in script
    assert "awun-line-comments-v1" in script
    assert "TRACK STORY" in script
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

    assert "AWUN / PERSONAL RADIO" in html and "MY WAVE" in html
    assert all(value in html for value in ("FAMILIAR", "BALANCED", "NEW", "MOOD", "ACTIVITY", "LANGUAGE", "ERA"))
    assert "awun-wave-profile-v2" in script
    assert "candidateScore" in script and "rankCandidates" in script
    assert all(signal in script for signal in ("'play'", "'skip'", "'listen30'", "'complete'", "'like'", "'dislike'"))
    assert "Promise.allSettled" in script and "/api/v1/search" in script
    assert "window.awunApp" in app and "emitAwun('play'" in app and "emitAwun('complete'" in app
    assert ".flow-panel" in styles and ".flow-feedback.active" in styles


def test_public_url_import_is_automatic_and_account_safe() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    api = (ROOT / "backend" / "api" / "main.py").read_text(encoding="utf-8")

    assert 'id="importUrl"' in html and "PUBLIC PLAYLIST LINK" in html
    assert "/api/v1/library/import-url" in script and "matchAndSaveImported" in script
    assert 'f"{settings.api_prefix}/library/import-url"' in api
