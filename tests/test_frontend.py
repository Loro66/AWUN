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
    }.issubset(parser.ids)


def test_every_visual_theme_has_css_and_javascript_metadata() -> None:
    styles = (ROOT / "frontend" / "styles.css").read_text(encoding="utf-8")
    script = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")

    for theme in ("acid", "ultraviolet", "cobalt", "ember"):
        assert f'data-theme="{theme}"' in styles or theme == "acid"
        assert f"{theme}:{{label:" in script


def test_frontend_assets_share_cache_version() -> None:
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    style_version = re.search(r'/static/styles\.css\?v=([\d.]+)', html)
    script_version = re.search(r'/static/app\.js\?v=([\d.]+)', html)

    assert style_version is not None
    assert script_version is not None
    assert style_version.group(1) == script_version.group(1)
