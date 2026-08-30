"""Optional Windows DPI compatibility for AWUN desktop.

This module integrates a narrow subset of Flowseal/zapret behavior for AWUN's
SoundCloud and YouTube traffic. It is not a VPN and never changes the public IP
address. The helper is optional and Windows-only.

Security properties:
- only the official GitHub release API and release ZIP are used;
- the GitHub-published SHA256 digest is mandatory;
- the archive is verified once after download and again after an elevated copy;
- the service executable lives under Program Files, not a user-writable folder;
- the elevated PowerShell payload is passed as EncodedCommand;
- no broad IP set or game filter is enabled.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
from typing import Any
from urllib.request import Request, urlopen
import zipfile


FLOWSEAL_LATEST_RELEASE_API = (
    "https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases/latest"
)
SERVICE_NAME = "AWUNRegionCompat"
EXTERNAL_ZAPRET_SERVICE = "zapret"

# Exact text of Flowseal/zapret-discord-youtube LICENSE.txt from the upstream
# repository. Release archives do not always contain this file, so AWUN writes
# the notice next to the installed helper instead of rejecting an otherwise
# valid official release ZIP.
FLOWSEAL_LICENSE_TEXT = """MIT License

Copyright (c) 2016-2026 bol-van
Copyright (c) 2024-2026 Flowseal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

This repository contains binary files originating from the project by bol-van,
available at: https://github.com/bol-van/zapret/ (licensed under the MIT License).

This repository also includes and depends on WinDivert
(https://github.com/basil00/WinDivert), which is licensed under your choice of:

1. The GNU Lesser General Public License (LGPL) Version 3, or
2. The GNU General Public License (GPL) Version 2.

Binary distributions of WinDivert are included in this project as-is, without modification.
The corresponding source code and license terms for WinDivert are available at
https://github.com/basil00/WinDivert.

---

To comply with the licenses of these projects:

1. The original copyright notices and licenses (above) are retained.
2. The use of WinDivert in this project is governed by its licensing terms (LGPLv3/GPLv2).
3. This repository provides only binary files and does not include the source code of
   the project by bol-van or modifications to WinDivert.
"""

SOUNDCLOUD_HOSTS = (
    "soundcloud.com",
    "api.soundcloud.com",
    "api-v2.soundcloud.com",
    "api-auth.soundcloud.com",
    "secure.soundcloud.com",
    "sndcdn.com",
    "a-v2.sndcdn.com",
    "cf-hls-media.sndcdn.com",
    "cf-hls-opus-media.sndcdn.com",
    "soundcloud.cloud",
    "playback.media-streaming.soundcloud.cloud",
    "player.media-streaming.soundcloud.cloud",
)

# Focused YouTube host list derived from Flowseal's list-google.txt. Deliberately
# excludes unrelated Google domains.
YOUTUBE_HOSTS = (
    "yt3.ggpht.com",
    "yt4.ggpht.com",
    "yt3.googleusercontent.com",
    "googlevideo.com",
    "jnn-pa.googleapis.com",
    "wide-youtube.l.google.com",
    "youtube-nocookie.com",
    "youtube-ui.l.google.com",
    "youtube.com",
    "youtubeembeddedplayer.googleapis.com",
    "youtubekids.com",
    "youtube.googleapis.com",
    "youtubei.googleapis.com",
    "youtu.be",
    "yt-video-upload.l.google.com",
    "ytimg.com",
    "ytimg.l.google.com",
)

_REQUIRED_ARCHIVE_SUFFIXES = (
    "bin/winws.exe",
    "bin/WinDivert.dll",
    "bin/WinDivert64.sys",
    "bin/quic_initial_www_google_com.bin",
    "bin/tls_clienthello_www_google_com.bin",
    "bin/tls_clienthello_4pda_to.bin",
)


class RegionCompatError(RuntimeError):
    pass


def _creationflags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _service_state(name: str) -> str | None:
    if platform.system() != "Windows":
        return None
    result = subprocess.run(
        ["sc.exe", "query", name],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        creationflags=_creationflags(),
        check=False,
    )
    if result.returncode != 0:
        return None
    text = f"{result.stdout}\n{result.stderr}".upper()
    if "RUNNING" in text:
        return "running"
    if "STOP_PENDING" in text:
        return "stopping"
    if "START_PENDING" in text:
        return "starting"
    if "STOPPED" in text:
        return "stopped"
    return "installed"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _quote_ps(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _safe_version(value: str) -> str:
    clean = "".join(character for character in value if character.isalnum() or character in ".-_")
    if not clean:
        raise RegionCompatError("Некорректная версия релиза Flowseal")
    return clean[:80]


def _validate_archive(archive: Path) -> None:
    try:
        with zipfile.ZipFile(archive) as bundle:
            names: list[str] = []
            for member in bundle.infolist():
                normalized = member.filename.replace("\\", "/")
                path = PurePosixPath(normalized)
                if path.is_absolute() or ".." in path.parts:
                    raise RegionCompatError("Архив Flowseal содержит небезопасный путь")
                names.append(normalized)
    except zipfile.BadZipFile as exc:
        raise RegionCompatError("Скачанный файл Flowseal не является корректным ZIP") from exc

    lower_names = [name.lower() for name in names]
    missing = [
        suffix
        for suffix in _REQUIRED_ARCHIVE_SUFFIXES
        if not any(name.endswith(suffix.lower()) for name in lower_names)
    ]
    if missing:
        raise RegionCompatError(
            "В релизе Flowseal отсутствуют обязательные файлы: " + ", ".join(missing)
        )


class RegionalCompatibilityManager:
    """Download, verify and manage the optional AWUNRegionCompat service."""

    def __init__(self, root: Path | None = None) -> None:
        if root is None:
            local_app_data = os.getenv("LOCALAPPDATA")
            base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
            root = base / "AWUN" / "regional-compat"
        self.root = Path(root)
        self.download_dir = self.root / "downloads"
        self.current_file = self.root / "current.json"

    @property
    def supported(self) -> bool:
        return platform.system() == "Windows"

    def status(self) -> dict[str, Any]:
        state = _service_state(SERVICE_NAME) if self.supported else None
        metadata = self._read_current()
        external_state = _service_state(EXTERNAL_ZAPRET_SERVICE) if self.supported else None
        return {
            "supported": self.supported,
            "installed": state is not None,
            "running": state == "running",
            "state": state or "not-installed",
            "flowseal_version": metadata.get("version"),
            "external_zapret_running": external_state == "running",
            "scope": "soundcloud-youtube-only",
        }

    def enable(self) -> dict[str, Any]:
        if not self.supported:
            return {"ok": False, "error": "Режим совместимости доступен только в Windows"}
        try:
            if _service_state(EXTERNAL_ZAPRET_SERVICE) == "running":
                raise RegionCompatError(
                    "Обнаружена уже запущенная служба zapret. Останови внешний zapret перед "
                    "включением режима AWUN, чтобы два фильтра не конфликтовали."
                )
            archive, version, expected_sha256 = self._ensure_latest_archive()
            self._run_elevated(self._build_install_payload(archive, version, expected_sha256))
            if _service_state(SERVICE_NAME) != "running":
                raise RegionCompatError(
                    "Служба была установлена, но не перешла в состояние RUNNING"
                )
            self._write_current(version)
            return {"ok": True, **self.status()}
        except Exception as exc:
            return {"ok": False, "error": str(exc), **self.status()}

    def disable(self) -> dict[str, Any]:
        if not self.supported:
            return {"ok": False, "error": "Режим совместимости доступен только в Windows"}
        try:
            self._run_elevated(self._build_uninstall_payload())
            if _service_state(SERVICE_NAME) is not None:
                raise RegionCompatError("Windows не удалила службу AWUNRegionCompat")
            return {"ok": True, **self.status()}
        except Exception as exc:
            return {"ok": False, "error": str(exc), **self.status()}

    def _request_json(self, url: str) -> dict[str, Any]:
        request = Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "AWUN/1.8 regional-compat",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise RegionCompatError("GitHub вернул некорректные данные релиза")
        return payload

    def _ensure_latest_archive(self) -> tuple[Path, str, str]:
        release = self._request_json(FLOWSEAL_LATEST_RELEASE_API)
        version = _safe_version(str(release.get("tag_name") or "").strip())
        assets = release.get("assets") or []
        if not isinstance(assets, list):
            raise RegionCompatError("Не удалось прочитать список файлов релиза Flowseal")

        asset = next(
            (
                item
                for item in assets
                if isinstance(item, dict)
                and str(item.get("name") or "").lower().endswith(".zip")
            ),
            None,
        )
        if not asset:
            raise RegionCompatError("В актуальном релизе Flowseal нет ZIP-архива")

        digest = str(asset.get("digest") or "")
        expected_sha256 = digest.partition(":")[2].lower() if digest.startswith("sha256:") else ""
        if len(expected_sha256) != 64 or any(c not in "0123456789abcdef" for c in expected_sha256):
            raise RegionCompatError(
                "GitHub не опубликовал корректный SHA256 для Flowseal; AWUN не запустит непроверенный бинарник"
            )

        download_url = str(asset.get("browser_download_url") or "")
        if not download_url.startswith("https://github.com/"):
            raise RegionCompatError("Некорректная ссылка на релиз Flowseal")

        self.download_dir.mkdir(parents=True, exist_ok=True)
        archive = self.download_dir / f"flowseal-{version}.zip"
        if archive.is_file() and _sha256(archive) == expected_sha256:
            _validate_archive(archive)
            return archive, version, expected_sha256

        temporary = archive.with_suffix(".zip.part")
        temporary.unlink(missing_ok=True)
        request = Request(download_url, headers={"User-Agent": "AWUN/1.8 regional-compat"})
        try:
            with urlopen(request, timeout=60) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output)
            if _sha256(temporary) != expected_sha256:
                raise RegionCompatError(
                    "SHA256 архива Flowseal не совпал с хэшем, опубликованным GitHub"
                )
            _validate_archive(temporary)
            temporary.replace(archive)
        finally:
            temporary.unlink(missing_ok=True)
        return archive, version, expected_sha256

    def _build_install_payload(self, archive: Path, version: str, expected_sha256: str) -> str:
        soundcloud = "`n".join(SOUNDCLOUD_HOSTS) + "`n"
        youtube = "`n".join(YOUTUBE_HOSTS) + "`n"
        license_b64 = base64.b64encode(FLOWSEAL_LICENSE_TEXT.encode("utf-8")).decode("ascii")
        version = _safe_version(version)

        # Strategy follows the same TCP/QUIC desync primitives used by Flowseal,
        # but removes broad IP/game filters and limits interception to AWUN hosts.
        return f"""$ErrorActionPreference = 'Stop'
$service = '{SERVICE_NAME}'
$sourceArchive = {_quote_ps(archive)}
$expected = '{expected_sha256.upper()}'
$base = Join-Path $env:ProgramFiles 'AWUN\RegionalCompat'
$target = Join-Path $base 'flowseal-{version}'
$stagedArchive = Join-Path $base 'flowseal-{version}.zip'

$existing = Get-Service -Name $service -ErrorAction SilentlyContinue
if ($existing) {{
    if ($existing.Status -ne 'Stopped') {{ Stop-Service -Name $service -Force -ErrorAction SilentlyContinue }}
    & sc.exe delete $service | Out-Null
    Start-Sleep -Milliseconds 700
}}

if (Test-Path $base) {{ Remove-Item $base -Recurse -Force }}
New-Item -ItemType Directory -Force -Path $base | Out-Null
Copy-Item -LiteralPath $sourceArchive -Destination $stagedArchive -Force
$actual = (Get-FileHash -LiteralPath $stagedArchive -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actual -ne $expected) {{ throw 'Flowseal SHA256 mismatch after elevated copy' }}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Expand-Archive -LiteralPath $stagedArchive -DestinationPath $target -Force
Remove-Item -LiteralPath $stagedArchive -Force

$winwsItem = Get-ChildItem -LiteralPath $target -Filter 'winws.exe' -File -Recurse | Where-Object {{ $_.Directory.Name -ieq 'bin' }} | Select-Object -First 1
if (-not $winwsItem) {{ throw 'winws.exe not found after extraction' }}
$helperRoot = Split-Path (Split-Path $winwsItem.FullName -Parent) -Parent
$bin = Join-Path $helperRoot 'bin'
$lists = Join-Path $helperRoot 'lists'
$winws = Join-Path $bin 'winws.exe'
$windivertDll = Join-Path $bin 'WinDivert.dll'
$windivertSys = Join-Path $bin 'WinDivert64.sys'
$quic = Join-Path $bin 'quic_initial_www_google_com.bin'
$tlsGoogle = Join-Path $bin 'tls_clienthello_www_google_com.bin'
$tlsGeneral = Join-Path $bin 'tls_clienthello_4pda_to.bin'
foreach ($required in @($winws,$windivertDll,$windivertSys,$quic,$tlsGoogle,$tlsGeneral)) {{
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {{ throw ('Required Flowseal file missing: ' + $required) }}
}}

$license = Join-Path $helperRoot 'LICENSE.txt'
$licenseBytes = [Convert]::FromBase64String('{license_b64}')
[IO.File]::WriteAllBytes($license, $licenseBytes)
if (-not (Test-Path -LiteralPath $license -PathType Leaf)) {{ throw 'Unable to write Flowseal LICENSE.txt' }}

New-Item -ItemType Directory -Force -Path $lists | Out-Null
Set-Content -LiteralPath (Join-Path $lists 'awun-soundcloud.txt') -Value "{soundcloud}" -Encoding ASCII
Set-Content -LiteralPath (Join-Path $lists 'awun-youtube.txt') -Value "{youtube}" -Encoding ASCII
$soundcloudList = Join-Path $lists 'awun-soundcloud.txt'
$youtubeList = Join-Path $lists 'awun-youtube.txt'

$args = @(
    '--wf-tcp=80,443',
    '--wf-udp=443',
    '--filter-udp=443',
    ('--hostlist="' + $soundcloudList + '"'),
    '--dpi-desync=fake',
    '--dpi-desync-repeats=6',
    ('--dpi-desync-fake-quic="' + $quic + '"'),
    '--new',
    '--filter-udp=443',
    ('--hostlist="' + $youtubeList + '"'),
    '--dpi-desync=fake',
    '--dpi-desync-repeats=6',
    ('--dpi-desync-fake-quic="' + $quic + '"'),
    '--new',
    '--filter-tcp=443',
    ('--hostlist="' + $youtubeList + '"'),
    '--ip-id=zero',
    '--dpi-desync=multisplit',
    '--dpi-desync-split-seqovl=681',
    '--dpi-desync-split-pos=1',
    ('--dpi-desync-split-seqovl-pattern="' + $tlsGoogle + '"'),
    '--new',
    '--filter-tcp=80,443',
    ('--hostlist="' + $soundcloudList + '"'),
    '--dpi-desync=multisplit',
    '--dpi-desync-split-seqovl=568',
    '--dpi-desync-split-pos=1',
    ('--dpi-desync-split-seqovl-pattern="' + $tlsGeneral + '"')
)
$binary = '"' + $winws + '" ' + ($args -join ' ')
New-Service -Name $service -BinaryPathName $binary -DisplayName 'AWUN Regional Compatibility' -StartupType Automatic | Out-Null
& sc.exe description $service 'Optional AWUN-only DPI compatibility for SoundCloud and YouTube' | Out-Null
Start-Service -Name $service
Start-Sleep -Milliseconds 1200
if ((Get-Service -Name $service).Status -ne 'Running') {{ throw 'AWUNRegionCompat did not start' }}
"""

    @staticmethod
    def _build_uninstall_payload() -> str:
        return f"""$ErrorActionPreference = 'Stop'
$service = '{SERVICE_NAME}'
$existing = Get-Service -Name $service -ErrorAction SilentlyContinue
if ($existing) {{
    if ($existing.Status -ne 'Stopped') {{ Stop-Service -Name $service -Force -ErrorAction SilentlyContinue }}
    & sc.exe delete $service | Out-Null
    Start-Sleep -Milliseconds 900
}}
$base = Join-Path $env:ProgramFiles 'AWUN\RegionalCompat'
if (Test-Path $base) {{ Remove-Item $base -Recurse -Force }}
"""

    @staticmethod
    def _run_elevated(powershell: str) -> None:
        encoded = base64.b64encode(powershell.encode("utf-16le")).decode("ascii")
        command = (
            "$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -PassThru -Wait "
            f"-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','{encoded}'); "
            "exit $p.ExitCode"
        )
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            creationflags=_creationflags(),
            check=False,
        )
        if result.returncode != 0:
            raise RegionCompatError(
                "Windows отклонила запрос UAC или режим совместимости завершился с ошибкой"
            )

    def _read_current(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.current_file.read_text(encoding="utf-8"))
            return payload if isinstance(payload, dict) else {}
        except (OSError, ValueError, TypeError):
            return {}

    def _write_current(self, version: str) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.current_file.write_text(
            json.dumps({"version": version}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
