"""Pinned, unmodified zapret runtime and YouTube-only strategy arguments.

The build downloads a fixed upstream release. Both the build and the elevated
helper verify every executable/data file; upstream batch/service scripts are
never packaged or executed. This module is also importable on non-Windows CI.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys
import subprocess
import tempfile

RELEASE = "1.10.3"
ARCHIVE_URL = f"https://github.com/Flowseal/zapret-discord-youtube/releases/download/{RELEASE}/zapret-discord-youtube-{RELEASE}.zip"
ARCHIVE_SHA256 = "244314ae1c24538a0d751601da8e0c925c843371eec4456eb15f14c4fd6b7058"
FILE_HASHES = {
    "winws.exe": "affb4f69d2ea302a7abccd5325d81826e140ddae014f1e070bc4a6c0dd555188",
    "WinDivert.dll": "c1e060ee19444a259b2162f8af0f3fe8c4428a1c6f694dce20de194ac8d7d9a2",
    "WinDivert64.sys": "8da085332782708d8767bcace5327a6ec7283c17cfb85e40b03cd2323a90ddc2",
    "cygwin1.dll": "103104a52e5293ce418944725df19e2bf81ad9269b9a120d71d39028e821499b",
    "quic_initial_www_google_com.bin": "f4589c57749f956bb30538197a521d7005f8b0a8723b4707e72405e51ddac50a",
    "tls_clienthello_www_google_com.bin": "936c2bee4cfb80aa3c426b2dcbcc834b3fbcd1adb17172959dc569c73a14275c",
}
PROFILES = ("alt13", "alt11", "general")
# Subset of upstream list-google: no Discord, Play Store or general IP ranges.
YOUTUBE_HOSTS = (
    "youtube.com", "youtube-nocookie.com", "youtu.be", "googlevideo.com",
    "ytimg.com", "ytimg.l.google.com", "yt3.ggpht.com", "yt4.ggpht.com",
    "yt3.googleusercontent.com", "wide-youtube.l.google.com",
    "youtube-ui.l.google.com", "youtubeembeddedplayer.googleapis.com",
    "youtube.googleapis.com", "youtubei.googleapis.com", "jnn-pa.googleapis.com",
)


def runtime_directory() -> Path:
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    return root / "desktop" / "vendor" / "zapret"


def verified_files(directory: Path) -> dict[str, bytes]:
    """Read once, then hash the exact bytes that will be installed by the helper."""
    result = {}
    for name, expected in FILE_HASHES.items():
        path = directory / name
        if path.stat().st_size > 4 * 1024 * 1024:
            raise ValueError("Oversized network component")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("Network component checksum mismatch")
        result[name] = data
    return result


def strategy_arguments(directory: Path, profile: str) -> list[str]:
    if profile not in PROFILES:
        raise ValueError("Unknown YouTube profile")
    hosts = f"--hostlist={directory / 'youtube-hosts.txt'}"
    google = directory / "tls_clienthello_www_google_com.bin"
    arguments = [
        str(directory / "winws.exe"), "--wf-tcp=443", "--wf-udp=443",
        "--filter-udp=443", hosts, "--dpi-desync=fake",
        f"--dpi-desync-repeats={6 if profile == 'general' else 11}",
        f"--dpi-desync-fake-quic={directory / 'quic_initial_www_google_com.bin'}",
        "--new", "--filter-tcp=443", hosts,
    ]
    if profile == "alt13":
        arguments.extend([
            "--dpi-desync=hostfakesplit", "--dpi-desync-fooling=ts",
            "--dpi-desync-hostfakesplit-mod=host=www.google.com",
        ])
    else:
        arguments.extend([
            "--ip-id=zero",
            f"--dpi-desync={'fake,multisplit' if profile == 'alt11' else 'multisplit'}",
            "--dpi-desync-split-seqovl=681", "--dpi-desync-split-pos=1",
            f"--dpi-desync-split-seqovl-pattern={google}",
        ])
        if profile == "alt11":
            arguments.extend(["--dpi-desync-fooling=ts", "--dpi-desync-repeats=8", f"--dpi-desync-fake-tls={google}"])
    return arguments


def check_packaged_runtime() -> int:
    """Release smoke check: verify the packed bytes and parse all profiles.

    winws --dry-run exits before loading WinDivert or intercepting any traffic.
    This check requires neither elevation nor a browser/server window.
    """
    if sys.platform != "win32":
        return 21
    try:
        payloads = verified_files(runtime_directory())
        with tempfile.TemporaryDirectory(prefix="songvale-network-check-") as folder:
            directory = Path(folder)
            for name, data in payloads.items():
                (directory / name).write_bytes(data)
            (directory / "youtube-hosts.txt").write_text("\n".join(YOUTUBE_HOSTS), encoding="ascii")
            for profile in PROFILES:
                result = subprocess.run([*strategy_arguments(directory, profile), "--dry-run"], cwd=directory, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
                if result.returncode:
                    return 23
        return 0
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return 24
