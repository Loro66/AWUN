from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def test_all_third_party_actions_are_pinned_to_commits() -> None:
    workflows = list((ROOT / ".github" / "workflows").glob("*.yml"))
    uses: list[str] = []
    for workflow in workflows:
        uses.extend(
            re.findall(
                r"^\s*-?\s*uses:\s*([^\s#]+)",
                workflow.read_text(encoding="utf-8"),
                flags=re.MULTILINE,
            )
        )

    remote_actions = [value for value in uses if not value.startswith("./")]
    assert remote_actions
    assert all(re.fullmatch(r"[^@\s]+@[0-9a-f]{40}", value) for value in remote_actions)


def test_dependency_updates_audits_and_hash_lock_are_configured() -> None:
    dependabot = (ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")
    security = (ROOT / ".github" / "workflows" / "security.yml").read_text(encoding="utf-8")
    lock = (ROOT / "requirements.lock").read_text(encoding="utf-8")
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert dependabot.count("package-ecosystem:") == 4
    assert "gh-action-pip-audit" in security and "github/codeql-action" in security
    assert "--hash=sha256:" in lock
    assert "--require-hashes -r requirements.lock" in dockerfile
