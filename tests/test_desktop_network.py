from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

import pytest

from desktop import network_access, network_runtime, network_windows
from desktop.prepare_network_runtime import unpack_verified_archive


def eventually(predicate, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    assert predicate()


class FakeWindows:
    def __init__(self):
        self.kernel = self
        self.events = {}
        self.process = threading.Event()
        self.external = None
        self.calls = []
        self.code = 0
        self.permission = threading.Event()
        self.permission.set()
        self.reject = False

    def create_event(self, name):
        self.events[name] = threading.Event()
        return self.events[name]

    def SetEvent(self, event):
        event.set()
        return True

    def external_process(self):
        return self.external

    def close(self, handle):
        self.calls.append(("close", handle))
        self.events = {name: event for name, event in self.events.items() if event is not handle}

    def signaled(self, handle, milliseconds=0):
        if handle is self.process and any(event.is_set() for name, event in self.events.items() if name.endswith("_stop")):
            self.process.set()
        return handle.wait(min(milliseconds / 1000, 0.01))

    def elevate(self, token, profile):
        self.calls.append(("elevate", profile))
        self.permission.wait(3)
        if self.reject:
            error = OSError("UAC cancelled")
            error.winerror = 1223
            raise error
        self.events[network_windows.event_name(token, "ready")].set()
        return self.process

    def exit_code(self, process):
        return self.code


@pytest.fixture
def controller(monkeypatch):
    windows = FakeWindows()
    monkeypatch.setattr(network_access.sys, "platform", "win32")
    monkeypatch.setattr(network_access, "Windows", lambda: windows)
    monkeypatch.setattr(network_access, "verified_files", lambda directory: {})
    access = network_access.DesktopNetworkAccess()
    yield access, windows
    access.close()


def test_network_does_not_start_on_launch_and_rejects_unknown_profiles(controller):
    access, windows = controller
    assert access.status()["stage"] == "off"
    assert not access.start("alt13 & arbitrary-command")
    assert not access.start({"profile": "alt13"})
    assert windows.calls == []


def test_external_zapret_is_never_launched_or_stopped(controller):
    access, windows = controller
    windows.external = "winws2.exe"
    assert access.status()["stage"] == "external"
    assert not access.start("alt13")
    assert access.stop()
    assert access.status()["stage"] == "external"
    assert windows.calls == []


def test_external_zapret_exit_unblocks_the_builtin_module(controller):
    access, windows = controller
    windows.external = "winws.exe"
    assert not access.start("alt13")
    assert access.status()["stage"] == "external"
    windows.external = None
    access._external_at = 0
    assert access.status()["stage"] == "off"
    assert access.start("alt13")
    eventually(lambda: access.status()["stage"] == "running")


def test_own_session_starts_stops_and_closes_all_handles(controller):
    access, windows = controller
    assert access.start("alt13")
    eventually(lambda: access.status()["stage"] == "running")
    assert not access.start("alt11")
    assert access.stop()
    eventually(lambda: access.status()["stage"] == "off")
    eventually(lambda: access._session is None)
    assert len([call for call in windows.calls if call[0] == "close"]) == 3
    assert [(call[0], call[1]) for call in windows.calls if call[0] == "elevate"] == [("elevate", "alt13")]


def test_uac_decline_is_retryable_without_leaking_events(controller):
    access, windows = controller
    windows.reject = True
    assert access.start("alt13")
    eventually(lambda: access._session is None)
    assert access.status()["error"] == "permission"
    windows.reject = False
    assert access.start("alt11")
    eventually(lambda: access.status()["stage"] == "running")


def test_stopping_during_uac_prevents_a_late_helper_from_running(controller):
    access, windows = controller
    windows.permission.clear()
    assert access.start("alt13")
    eventually(lambda: access.status()["stage"] == "permission")
    access.stop()
    windows.permission.set()
    eventually(lambda: access._session is None)
    assert access.status()["stage"] == "off"
    assert windows.process.is_set()


def test_driver_exit_is_reported_and_handles_are_closed(controller):
    access, windows = controller
    windows.code = 23
    assert access.start("alt13")
    eventually(lambda: access.status()["stage"] == "running")
    windows.process.set()
    eventually(lambda: access._session is None)
    assert access.status()["error"] == "driver"


def test_corrupt_component_never_reaches_uac(controller, monkeypatch):
    access, windows = controller
    def corrupt(_directory):
        raise ValueError("Bad hash")
    monkeypatch.setattr(network_access, "verified_files", corrupt)
    assert access.start("alt13")
    eventually(lambda: access._session is None)
    assert access.status()["error"] == "component"
    assert not any(call[0] == "elevate" for call in windows.calls)


def test_runtime_verifies_bytes_before_they_are_installed(tmp_path, monkeypatch):
    payload = b"trusted fixture"
    monkeypatch.setattr(network_runtime, "FILE_HASHES", {"winws.exe": hashlib.sha256(payload).hexdigest()})
    (tmp_path / "winws.exe").write_bytes(payload)
    assert network_runtime.verified_files(tmp_path) == {"winws.exe": payload}
    (tmp_path / "winws.exe").write_bytes(b"changed")
    with pytest.raises(ValueError, match="checksum"):
        network_runtime.verified_files(tmp_path)


def test_untrusted_archive_is_rejected_before_any_files_are_written(tmp_path):
    with pytest.raises(ValueError, match="checksum"):
        unpack_verified_archive(b"not the official archive", tmp_path / "runtime")
    assert not (tmp_path / "runtime").exists()


@pytest.mark.parametrize("profile", network_runtime.PROFILES)
def test_profiles_limit_traffic_to_youtube_and_use_fixed_arguments(tmp_path, profile):
    arguments = network_runtime.strategy_arguments(tmp_path, profile)
    assert "--wf-tcp=443" in arguments and "--wf-udp=443" in arguments
    assert arguments.count(f"--hostlist={tmp_path / 'youtube-hosts.txt'}") == 2
    assert not any("ipset" in argument or "any-protocol" in argument or "discord" in argument for argument in arguments)
    assert "googlevideo.com" in network_runtime.YOUTUBE_HOSTS
    assert "youtube-nocookie.com" in network_runtime.YOUTUBE_HOSTS


@pytest.mark.parametrize("token", ["", "../path", "f" * 31, "F" * 32, "f" * 33])
def test_helper_rejects_untrusted_session_identifiers(token):
    with pytest.raises(ValueError):
        network_windows.event_name(token, "stop")
    assert network_windows.helper_main([token, str(os.getpid()), "alt13"]) == 21


@pytest.mark.skipif(sys.platform != "win32", reason="Native Windows IPC")
def test_native_event_can_be_opened_by_a_child_and_signaled(tmp_path):
    windows = network_windows.Windows()
    token = "e" * 32
    name = network_windows.event_name(token, "ready")
    handle = windows.create_event(name)
    try:
        script = "from desktop.network_windows import Windows; w=Windows(); h=w.kernel.OpenEventW(2,False," + repr(name) + "); assert h; assert w.kernel.SetEvent(h); w.close(h)"
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, timeout=15)
        assert result.returncode == 0, result.stderr.decode(errors="replace")
        assert windows.signaled(handle, 1000)
        parent = windows.parent_process(os.getpid())
        windows.close(parent)
        assert windows.external_process() is None
    finally:
        windows.close(handle)


@pytest.mark.skipif(sys.platform != "win32", reason="Native supervisor crash cleanup")
def test_closing_the_job_handle_terminates_only_the_owned_child():
    windows = network_windows.Windows()
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    other = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    job = None
    try:
        job = windows.child_job(child)
        assert child.poll() is None
        windows.close(job)
        job = None
        child.wait(timeout=5)  # Windows may use exit code 0 for job-close termination.
        assert child.poll() is not None
        assert other.poll() is None
    finally:
        windows.close(job)
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        other.terminate()
        other.wait(timeout=5)


@pytest.mark.skipif(sys.platform != "win32", reason="Native upstream argument verification")
@pytest.mark.parametrize("profile", network_runtime.PROFILES)
def test_pinned_winws_accepts_each_profile_without_loading_a_driver(tmp_path, profile):
    from shutil import copy2
    source = network_runtime.runtime_directory()
    network_runtime.verified_files(source)
    for name in network_runtime.FILE_HASHES:
        copy2(source / name, tmp_path / name)
    (tmp_path / "youtube-hosts.txt").write_text("\n".join(network_runtime.YOUTUBE_HOSTS), encoding="ascii")
    arguments = network_runtime.strategy_arguments(tmp_path, profile)
    result = subprocess.run([*arguments, "--dry-run"], capture_output=True, timeout=15)
    assert result.returncode == 0, (result.stdout + result.stderr).decode(errors="replace")
