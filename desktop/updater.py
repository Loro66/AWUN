"""Fetch a verified official installer and preserve the running app on failure."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
from urllib.request import build_opener, HTTPSHandler, HTTPRedirectHandler, Request

RELEASE_API = "https://api.github.com/repos/Loro66/AWUN/releases/latest"
RELEASE_PREFIX = "https://github.com/Loro66/AWUN/releases/download/"
INSTALLER_NAME = "SONGVALE-Setup-x64.exe"
MAX_INSTALLER_BYTES = 150 * 1024 * 1024
ALLOWED_DOWNLOAD_HOSTS = {"github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}


def version_parts(value):
    if not isinstance(value, str) or not re.fullmatch(r"v?\d{1,5}\.\d{1,5}\.\d{1,5}", value):
        raise ValueError("Invalid stable version")
    return tuple(int(part) for part in value.lstrip("v").split("."))


def validate_url(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_DOWNLOAD_HOSTS or parsed.username or parsed.password or parsed.port not in {None, 443}:
        raise ValueError("Unexpected update URL")
    return url


class SafeRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def official_request(url):
    validate_url(url)
    opener = build_opener(SafeRedirects(), HTTPSHandler(context=ssl.create_default_context()))
    return opener.open(Request(url, headers={"User-Agent": "SONGVALE-Updater", "Accept": "application/vnd.github+json"}), timeout=20)


def installer_manifest(release, current_version):
    if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
        raise ValueError("Not a stable release")
    latest = release.get("tag_name", "")
    if version_parts(latest) <= version_parts(current_version):
        return None
    base = f"{RELEASE_PREFIX}{latest}/"
    assets = release.get("assets", [])
    installer = next((asset for asset in assets if asset.get("name") == INSTALLER_NAME), None)
    checksum = next((asset for asset in assets if asset.get("name") == INSTALLER_NAME + ".sha256"), None)
    if not installer or not checksum or installer.get("browser_download_url") != base + INSTALLER_NAME or checksum.get("browser_download_url") != base + INSTALLER_NAME + ".sha256":
        raise ValueError("Missing official installer/checksum")
    size = installer.get("size", 0)
    if not isinstance(size, int) or not 0 < size <= MAX_INSTALLER_BYTES:
        raise ValueError("Invalid installer size")
    digest = installer.get("digest")
    if digest is not None and not re.fullmatch(r"sha256:[0-9a-fA-F]{64}", digest):
        raise ValueError("Invalid asset digest")
    return {"version": latest.lstrip("v"), "url": installer["browser_download_url"], "checksum_url": checksum["browser_download_url"], "size": size, "digest": digest}


class DesktopUpdater:
    def __init__(self, current_version, launch=None, request=official_request):
        self.current_version = current_version
        self._request = request
        self._launch = launch or subprocess.Popen
        self._lock = threading.Lock()
        self._status = {"stage": "idle", "progress": 0}
        self._thread = None
        self._temporary = None
        self._installer = None
        self._expected_hash = None

    def status(self):
        with self._lock:
            return dict(self._status)

    def _set(self, stage, **values):
        with self._lock:
            self._status = {"stage": stage, "progress": self._status.get("progress", 0), **values}

    def start(self):
        with self._lock:
            if self._status["stage"] in {"checking", "downloading", "verifying", "ready", "installing"}:
                return False
            self._status = {"stage": "checking", "progress": 0}
        self._thread = threading.Thread(target=self._download, name="songvale-update", daemon=True)
        self._thread.start()
        return True

    def _download(self):
        try:
            with self._request(RELEASE_API) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError("Release metadata too large")
                manifest = installer_manifest(json.loads(raw), self.current_version)
            if manifest is None:
                self._set("current")
                return
            with self._request(manifest["checksum_url"]) as response:
                checksum = response.read(513).decode("ascii").strip()
            match = re.fullmatch(r"([0-9a-fA-F]{64})\s+\*?SONGVALE-Setup-x64\.exe", checksum)
            if not match:
                raise ValueError("Invalid checksum file")
            expected_hash = match[1].lower()
            if manifest["digest"] and manifest["digest"].split(":", 1)[1].lower() != expected_hash:
                raise ValueError("Release digest mismatch")
            self._cleanup()
            self._temporary = tempfile.TemporaryDirectory(prefix="songvale-update-")
            part = Path(self._temporary.name) / "installer.part"
            self._set("downloading", version=manifest["version"])
            digest, downloaded, deadline = hashlib.sha256(), 0, time.monotonic() + 180
            with self._request(manifest["url"]) as response, part.open("xb") as output:
                while block := response.read(256 * 1024):
                    downloaded += len(block)
                    if downloaded > manifest["size"] or time.monotonic() > deadline:
                        raise ValueError("Download exceeded its size/time budget")
                    output.write(block)
                    digest.update(block)
                    self._set("downloading", progress=min(99, round(downloaded * 100 / manifest["size"])), version=manifest["version"])
            self._set("verifying", progress=100, version=manifest["version"])
            if downloaded != manifest["size"] or digest.hexdigest() != expected_hash or part.read_bytes()[:2] != b"MZ":
                raise ValueError("Installer verification failed")
            installer = part.with_name(INSTALLER_NAME)
            part.rename(installer)
            self._installer, self._expected_hash = installer, expected_hash
            self._set("ready", progress=100, version=manifest["version"])
        except Exception:
            self._cleanup()
            self._set("error")

    def install(self):
        with self._lock:
            if self._status["stage"] != "ready" or not self._installer:
                return False
            self._status["stage"] = "installing"
        try:
            # Verify again immediately before execution, and never execute a
            # caller-supplied path, command or URL through the JS bridge.
            if hashlib.sha256(self._installer.read_bytes()).hexdigest() != self._expected_hash:
                raise ValueError("Installer changed after download")
            args = [str(self._installer), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/SONGVALEUPDATE=1"]
            if getattr(sys, "frozen", False):
                args.append(f"/DIR={Path(sys.executable).resolve().parent}")
            # Keep the installer alive after SONGVALE exits. It relaunches the
            # new app after successful installation using Inno's [Run] entry.
            self._launch(args, close_fds=True)
            return True
        except Exception:
            self._set("error")
            return False

    def _cleanup(self):
        self._installer = None
        self._expected_hash = None
        if self._temporary:
            self._temporary.cleanup()
            self._temporary = None

    def close(self):
        # The detached installer still needs its file after app shutdown.
        if self.status()["stage"] == "installing" and self._temporary:
            self._temporary._finalizer.detach()
        elif not self._thread or not self._thread.is_alive():
            self._cleanup()
