from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_freeware_license_is_bilingual_proprietary_and_not_open_source() -> None:
    license_text = (ROOT / "LICENSE.md").read_text(encoding="utf-8")

    assert "AWUN Proprietary Freeware License 1.0" in license_text
    assert "Закрытая freeware-лицензия AWUN 1.0" in license_text
    assert "It is not open-source" in license_text
    assert "Это не open-source" in license_text
    assert "exact, unmodified copy" in license_text
    assert "без рекламы" in license_text
    assert "hosted clone" in license_text
    assert "пожертвования" in license_text.lower()
    assert "non-waivable rights" in license_text


def test_eula_and_contributor_terms_are_shipped_and_linked() -> None:
    eula = (ROOT / "EULA.md").read_text(encoding="utf-8")
    cla = (ROOT / "CONTRIBUTOR_LICENSE_AGREEMENT.md").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    contributing = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "build-windows-exe.yml").read_text(encoding="utf-8")
    mobile_workflow = (ROOT / ".github" / "workflows" / "build-mobile.yml").read_text(encoding="utf-8")

    assert "AWUN End-User License Agreement" in eula
    assert "Пользовательское соглашение AWUN" in eula
    assert "AWUN Individual Contributor License Agreement" in cla
    assert "LICENSE.md" in readme and "EULA.md" in readme
    assert "CONTRIBUTOR_LICENSE_AGREEMENT.md" in contributing
    assert "dist/LICENSE.md" in workflow and "dist/EULA.md" in workflow
    assert "cp LICENSE.md EULA.md dist/android/" in mobile_workflow
    assert "cp LICENSE.md EULA.md dist/ios/" in mobile_workflow


def test_hosted_application_exposes_license_and_eula() -> None:
    api = (ROOT / "backend" / "api" / "main.py").read_text(encoding="utf-8")
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    assert '@app.get("/license"' in api
    assert '@app.get("/eula"' in api
    assert 'href="/license"' in html
    assert 'href="/eula"' in html
