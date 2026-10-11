"""Build-time download only; never fetch or execute an unpinned latest binary."""

from __future__ import annotations

import hashlib
import io
from pathlib import Path
import urllib.request
import zipfile

from desktop.network_runtime import ARCHIVE_SHA256, ARCHIVE_URL, FILE_HASHES, RELEASE, verified_files


def unpack_verified_archive(data: bytes, destination: Path) -> None:
    if hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("Upstream archive checksum mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        payloads = {}
        for name in FILE_HASHES:
            member = f"zapret-discord-youtube-{RELEASE}/bin/{name}"
            if archive.getinfo(member).file_size > 4 * 1024 * 1024:
                raise ValueError("Oversized upstream file")
            payloads[name] = archive.read(member)
        # Fixed names only: no extractall, paths or scripts supplied by the ZIP.
        for name, payload in payloads.items():
            if hashlib.sha256(payload).hexdigest() != FILE_HASHES[name]:
                raise ValueError("Upstream file checksum mismatch")
        destination.mkdir(parents=True, exist_ok=True)
        for name, payload in payloads.items():
            (destination / name).write_bytes(payload)
    verified_files(destination)


def main() -> None:
    destination = Path(__file__).resolve().parent / "vendor" / "zapret"
    try:
        verified_files(destination)
        return
    except (OSError, ValueError):
        pass
    request = urllib.request.Request(ARCHIVE_URL, headers={"User-Agent": "SONGVALE-build"})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read(3 * 1024 * 1024)
    unpack_verified_archive(data, destination)


if __name__ == "__main__":
    main()
