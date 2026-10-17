"""Assemble a Play listing from localized text and one shared image set."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import tempfile


ROOT = Path(__file__).resolve().parents[1]
FASTLANE = ROOT / "mobile" / "android" / "fastlane"


def package_listing(destination: Path) -> Path:
    destination = destination.resolve()
    if destination.exists():
        raise FileExistsError(f"Output already exists: {destination}")

    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    major, minor, patch = map(int, version.split("-", 1)[0].split("+", 1)[0].split("."))
    code = major * 1_000_000 + minor * 10_000 + patch * 100
    locales = sorted(path for path in (FASTLANE / "metadata" / "android").iterdir() if path.is_dir())
    if not locales:
        raise ValueError("No localized Play metadata")
    for locale in locales:
        if not (locale / "changelogs" / f"{code}.txt").is_file():
            raise ValueError(f"Missing current release notes for {locale.name}: {code}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="play-listing-", dir=destination.parent) as temporary:
        listing = Path(temporary) / "listing"
        shutil.copytree(FASTLANE / "metadata", listing)
        for locale in locales:
            images = listing / "android" / locale.name / "images"
            shutil.copytree(FASTLANE / "images", images, dirs_exist_ok=True)
            if (locale / "images").is_dir():
                shutil.copytree(locale / "images", images, dirs_exist_ok=True)
        listing.rename(destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        print(package_listing(args.destination))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Play listing: {error}\n")


if __name__ == "__main__":
    main()
