"""Release the corresponding upstream sources alongside redistributed binaries."""

from __future__ import annotations

import hashlib
from pathlib import Path
import urllib.request
import zipfile

SOURCES = {
    "zapret-v72.9.tar.gz": (
        "https://codeload.github.com/bol-van/zapret/tar.gz/refs/tags/v72.9",
        "f6f48fde0a93024701e350bee43ae12f14c26b6afacc7eef54c18faa275b3064",
    ),
    "WinDivert-v2.2.2.tar.gz": (
        "https://codeload.github.com/basil00/WinDivert/tar.gz/refs/tags/v2.2.2",
        "300c1b14e08652e0f8647bf06e9b212f924af76cb2459bd0f88da481c9b08336",
    ),
    "Cygwin-3.4.10.tar.gz": (
        "https://codeload.github.com/mirror/newlib-cygwin/tar.gz/refs/tags/cygwin-3.4.10",
        "7ce758ff6a03b31fb086da43146ef2895043babe5f56ada6637938b274799148",
    ),
}


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    destination = root / "dist" / "SONGVALE-Network-Sources.zip"
    destination.parent.mkdir(exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
            for name, (url, expected) in SOURCES.items():
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "SONGVALE-build"}), timeout=45) as response:
                    data = response.read(30 * 1024 * 1024)
                if hashlib.sha256(data).hexdigest() != expected:
                    raise ValueError("Upstream source checksum mismatch")
                archive.writestr(name, data)
            for path in (root / "frontend" / "network-licenses").iterdir():
                archive.write(path, f"licenses/{path.name}")
            archive.write(root / "frontend" / "network-notices.txt", "README.txt")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
