"""Optional Windows DPI-compatibility helper for AWUN desktop.

The helper is deliberately narrow: it installs a separate winws service that
only sees host names used by AWUN's SoundCloud and YouTube integrations. It is
not a VPN, does not change the public IP address, and does not route unrelated
traffic through a remote server.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
from typing import Any
from urllib.request import Request, urlopen
import zipfile


FLOWSEAL_LATEST_RELEASE_API = (
    "https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases/latest"
)
SERVICE_NAME = "AWUNRegionCompat"
EXTERNAL_ZAPRET_SERVICE = "zapret"

# Keep these lists intentionally narrow. Parent SoundCloud domains cover API,
# artwork and current media-streaming hosts. The YouTube entries mirror the
# focused Google/YouTube host list used by Flowseal rather than intercepting
# arbitrary Google traffic.
SOUNDCLOUD_HOSTS = (
    "soundcloud.com",
    "soundcloud.cloud",
    "sndcdn.com",
)
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


def _safe_extract(archive: Path, destination: Path) -> None:
    root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            try:
                target.relative_to(root)
            except ValueError as exc:
                raise RegionCompatError("Архив совместимости содержит небезопасный путь") from exc
        bundle.extractall(destination)


def _quote_ps(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


class RegionalCompatibilityManager:
    """Download, verify and manage the optional AWUNRegionCompat service."""

    def __init__(self, root: Path | None = None) -> None:
        if root is None:
            local_app_data = os.getenv("LOCALAPPDATA")
            base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
            root = base / "AWUN" / "regional-compat"
        self.root = Path(root)
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
            external_state = _service_state(EXTERNAL_ZAPRET_SERVICE)
            if external_state == "running":
                raise RegionCompatError(
                    "Обнаружена уже запущенная служба zapret. Останови внешний zapret перед "
                    "включением встроенного режима AWUN, чтобы два фильтра не конфликтовали."
                )
            helper_root, version = self._ensure_latest_helper()
            self._write_hostlists(helper_root)
            script = self._write_install_script(helper_root)
            self._run_elevated(script)
            state = _service_state(SERVICE_NAME)
            if state != "running":
                raise RegionCompatError(
                    "Служба была установлена, но не перешла в состояние RUNNING"
                )
            self._write_current(version, helper_root)
            return {"ok": True, **self.status()}
        except Exception as exc:
            return {"ok": False, "error": str(exc), **self.status()}

    def disable(self) -> dict[str, Any]:
        if not self.supported:
            return {"ok": False, "error": "Режим совместимости доступен только в Windows"}
        try:
            script = self._write_uninstall_script()
            self._run_elevated(script)
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

    def _ensure_latest_helper(self) -> tuple[Path, str]:
        release = self._request_json(FLOWSEAL_LATEST_RELEASE_API)
        version = str(release.get("tag_name") or "").strip()
        assets = release.get("assets") or []
        if not version or not isinstance(assets, list):
            raise RegionCompatError("Не удалось определить актуальный релиз Flowseal")

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
        if not digest.startswith("sha256:") or len(digest.partition(":")[2]) != 64:
            raise RegionCompatError(
                "GitHub не опубликовал SHA256 для архива Flowseal; непроверенный бинарник AWUN не запустит"
            )
        expected_sha256 = digest.partition(":")[2].lower()
        download_url = str(asset.get("browser_download_url") or "")
        if not download_url.startswith("https://github.com/"):
            raise RegionCompatError("Некорректная ссылка на релиз Flowseal")

        version_dir = self.root / f"flowseal-{version}"
        ready = self._find_helper_root(version_dir) if version_dir.exists() else None
        if ready:
            return ready, version

        self.root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="awun-region-", dir=self.root) as temporary:
            temp_dir = Path(temporary)
            archive = temp_dir / "flowseal.zip"
            request = Request(download_url, headers={"User-Agent": "AWUN/1.8 regional-compat"})
            with urlopen(request, timeout=60) as response, archive.open("wb") as output:
                shutil.copyfileobj(response, output)
            actual_sha256 = _sha256(archive)
            if actual_sha256 != expected_sha256:
                raise RegionCompatError(
                    "SHA256 архива Flowseal не совпал с хэшем, опубликованным GitHub"
                )

            extracted = temp_dir / "extracted"
            extracted.mkdir()
            _safe_extract(archive, extracted)
            helper_root = self._find_helper_root(extracted)
            if not helper_root:
                raise RegionCompatError("В архиве Flowseal не найден winws.exe")
            self._verify_required_files(helper_root)

            if version_dir.exists():
                shutil.rmtree(version_dir, ignore_errors=True)
            shutil.copytree(helper_root, version_dir)

        resolved = self._find_helper_root(version_dir)
        if not resolved:
            raise RegionCompatError("Не удалось подготовить локальную копию Flowseal")
        self._verify_required_files(resolved)
        return resolved, version

    @staticmethod
    def _find_helper_root(root: Path) -> Path | None:
        direct = root / "bin" / "winws.exe"
        if direct.is_file():
            return root
        for candidate in root.rglob("winws.exe"):
            if candidate.parent.name.lower() == "bin":
                return candidate.parent.parent
        return None

    @staticmethod
    def _verify_required_files(helper_root: Path) -> None:
        required = (
            helper_root / "bin" / "winws.exe",
            helper_root / "bin" / "WinDivert.dll",
            helper_root / "bin" / "WinDivert64.sys",
            helper_root / "bin" / "quic_initial_www_google_com.bin",
            helper_root / "bin" / "tls_clienthello_www_google_com.bin",
            helper_root / "bin" / "tls_clienthello_4pda_to.bin",
            helper_root / "LICENSE.txt",
        )
        missing = [path.name for path in required if not path.is_file()]
        if missing:
            raise RegionCompatError(
                "В релизе Flowseal отсутствуют обязательные файлы: " + ", ".join(missing)
            )

    @staticmethod
    def _write_hostlists(helper_root: Path) -> None:
        lists = helper_root / "lists"
        lists.mkdir(parents=True, exist_ok=True)
        (lists / "awun-soundcloud.txt").write_text(
            "\n".join(SOUNDCLOUD_HOSTS) + "\n", encoding="utf-8"
        )
        (lists / "awun-youtube.txt").write_text(
            "\n".join(YOUTUBE_HOSTS) + "\n", encoding="utf-8"
        )

    def _write_install_script(self, helper_root: Path) -> Path:
        scripts = self.root / "scripts"
        scripts.mkdir(parents=True, exist_ok=True)
        script = scripts / "install-awun-region-compat.ps1"
        bin_dir = helper_root / "bin"
        lists_dir = helper_root / "lists"
        winws = bin_dir / "winws.exe"
        quic = bin_dir / "quic_initial_www_google_com.bin"
        tls_google = bin_dir / "tls_clienthello_www_google_com.bin"
        tls_general = bin_dir / "tls_clienthello_4pda_to.bin"
        soundcloud = lists_dir / "awun-soundcloud.txt"
        youtube = lists_dir / "awun-youtube.txt"

        # The strategy is based on Flowseal's current default TCP/QUIC approach,
        # but all broad IP/game filters are deliberately removed.
        powershell = f"""$ErrorActionPreference = 'Stop'
$service = '{SERVICE_NAME}'
$winws = {_quote_ps(winws)}
$soundcloud = {_quote_ps(soundcloud)}
$youtube = {_quote_ps(youtube)}
$quic = {_quote_ps(quic)}
$tlsGoogle = {_quote_ps(tls_google)}
$tlsGeneral = {_quote_ps(tls_general)}

$existing = Get-Service -Name $service -ErrorAction SilentlyContinue
if ($existing) {{
    if ($existing.Status -ne 'Stopped') {{ Stop-Service -Name $service -Force -ErrorAction SilentlyContinue }}
    & sc.exe delete $service | Out-Null
    Start-Sleep -Milliseconds 600
}}

$args = @(
    '--wf-tcp=80,443',
    '--wf-udp=443',
    '--filter-udp=443',
    ('--hostlist="' + $soundcloud + '"'),
    '--dpi-desync=fake',
    '--dpi-desync-repeats=6',
    ('--dpi-desync-fake-quic="' + $quic + '"'),
    '--new',
    '--filter-udp=443',
    ('--hostlist="' + $youtube + '"'),
    '--dpi-desync=fake',
    '--dpi-desync-repeats=6',
    ('--dpi-desync-fake-quic="' + $quic + '"'),
    '--new',
    '--filter-tcp=443',
    ('--hostlist="' + $youtube + '"'),
    '--ip-id=zero',
    '--dpi-desync=multisplit',
    '--dpi-desync-split-seqovl=681',
    '--dpi-desync-split-pos=1',
    ('--dpi-desync-split-seqovl-pattern="' + $tlsGoogle + '"'),
    '--new',
    '--filter-tcp=80,443',
    ('--hostlist="' + $soundcloud + '"'),
    '--dpi-desync=multisplit',
    '--dpi-desync-split-seqovl=568',
    '--dpi-desync-split-pos=1',
    ('--dpi-desync-split-seqovl-pattern="' + $tlsGeneral + '"')
)
$binary = '"' + $winws + '" ' + ($args -join ' ')
New-Service -Name $service -BinaryPathName $binary -DisplayName 'AWUN Regional Compatibility' -StartupType Automatic | Out-Null
& sc.exe description $service 'Optional AWUN-only DPI compatibility for SoundCloud and YouTube' | Out-Null
Start-Service -Name $service
Start-Sleep -Milliseconds 900
if ((Get-Service -Name $service).Status -ne 'Running') {{ exit 7 }}
"""
        script.write_text(powershell, encoding="utf-8-sig")
        return script

    def _write_uninstall_script(self) -> Path:
        scripts = self.root / "scripts"
        scripts.mkdir(parents=True, exist_ok=True)
        script = scripts / "remove-awun-region-compat.ps1"
        powershell = f"""$ErrorActionPreference = 'Stop'
$service = '{SERVICE_NAME}'
$existing = Get-Service -Name $service -ErrorAction SilentlyContinue
if ($existing) {{
    if ($existing.Status -ne 'Stopped') {{ Stop-Service -Name $service -Force -ErrorAction SilentlyContinue }}
    & sc.exe delete $service | Out-Null
    Start-Sleep -Milliseconds 700
}}
"""
        script.write_text(powershell, encoding="utf-8-sig")
        return script

    @staticmethod
    def _run_elevated(script: Path) -> None:
        escaped = str(script).replace("'", "''")
        command = (
            "$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -PassThru -Wait "
            f"-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','{escaped}'); "
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
                "Windows отклонила установку режима совместимости или служба завершилась с ошибкой"
            )

    def _read_current(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.current_file.read_text(encoding="utf-8"))
            return payload if isinstance(payload, dict) else {}
        except (OSError, ValueError, TypeError):
            return {}

    def _write_current(self, version: str, helper_root: Path) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.current_file.write_text(
            json.dumps(
                {"version": version, "helper_root": str(helper_root)},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
