"""Canonical AWUN release version loaded from the repository VERSION file."""

from pathlib import Path
import re


VERSION_FILE = Path(__file__).resolve().parents[2] / "VERSION"
_VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


def read_version() -> str:
    """Read and validate the single version shared by every AWUN target."""

    try:
        version = VERSION_FILE.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"AWUN VERSION file is missing: {VERSION_FILE}") from exc
    if not _VERSION_PATTERN.fullmatch(version):
        raise RuntimeError(f"Invalid AWUN version in {VERSION_FILE}: {version!r}")
    return version


APP_VERSION = read_version()
