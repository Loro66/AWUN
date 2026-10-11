"""Explicitly enabled, per-launch Windows access helper; no global service."""

from __future__ import annotations

import secrets
import sys
import threading
import time

from desktop.network_runtime import PROFILES, RELEASE, runtime_directory, verified_files
from desktop.network_windows import HELPER_FLAG, Windows, event_name, helper_main


class NetworkSession:
    def __init__(self, windows: Windows, token: str) -> None:
        self.windows, self.token = windows, token
        self.stop_event = windows.create_event(event_name(token, "stop"))
        try:
            self.ready_event = windows.create_event(event_name(token, "ready"))
        except Exception:
            windows.close(self.stop_event)
            raise
        self.process = None

    def stop(self) -> None:
        self.windows.kernel.SetEvent(self.stop_event)

    def close(self) -> None:
        for handle in (self.process, self.ready_event, self.stop_event):
            self.windows.close(handle)


class DesktopNetworkAccess:
    def __init__(self) -> None:
        self.supported = sys.platform == "win32"
        self._windows = Windows() if self.supported else None
        self._lock = threading.RLock()
        self._state = {"stage": "off", "profile": "alt13", "error": ""}
        self._session = None
        self._thread = None
        self._closed = False
        self._external_at = 0.0
        self._external = None

    def status(self) -> dict:
        with self._lock:
            result = {"supported": self.supported, "component_version": RELEASE, **self._state}
            if self.supported and result["stage"] in {"off", "external", "error"} and not self._session:
                if time.monotonic() - self._external_at > 2:
                    try:
                        self._external = self._windows.external_process()
                    except OSError:
                        self._external = None
                    self._external_at = time.monotonic()
                if self._external:
                    result["stage"], result["external"] = "external", self._external
            return result

    def _set(self, stage: str, error: str = "") -> None:
        with self._lock:
            self._state.update(stage=stage, error=error)

    def start(self, profile: str) -> bool:
        if not isinstance(profile, str) or profile not in PROFILES or not self.supported:
            return False
        with self._lock:
            if self._closed or self._session or (self._thread and self._thread.is_alive()):
                return False
            try:
                if self._windows.external_process():
                    self._set("external")
                    self._external_at = 0
                    return False
                session = NetworkSession(self._windows, secrets.token_hex(16))
            except OSError:
                self._set("error", "session")
                return False
            self._session = session
            self._state.update(stage="preparing", profile=profile, error="")
            self._thread = threading.Thread(target=self._run, args=(session, profile), name="songvale-network", daemon=True)
            self._thread.start()
            return True

    def _run(self, session: NetworkSession, profile: str) -> None:
        windows = self._windows
        stopped = False
        try:
            verified_files(runtime_directory())
            with self._lock:
                if self._closed or windows.signaled(session.stop_event):
                    stopped = True
                    return
                self._set("permission")
            session.process = windows.elevate(session.token, profile)
            if windows.signaled(session.stop_event):
                stopped = True
                windows.signaled(session.process, 5000)
                return
            self._set("starting")
            deadline = time.monotonic() + 45
            ready = False
            while not windows.signaled(session.process, 200):
                if windows.signaled(session.stop_event):
                    stopped = True
                    windows.signaled(session.process, 5000)
                    return
                if not ready and windows.signaled(session.ready_event):
                    ready = True
                    self._set("running")
                if not ready and time.monotonic() > deadline:
                    session.stop()
                    windows.signaled(session.process, 5000)
                    self._set("error", "timeout")
                    return
            code = windows.exit_code(session.process)
            if windows.signaled(session.stop_event):
                stopped = True
            else:
                self._set("external" if code == 22 else "error", "driver" if code == 23 else "helper")
        except (OSError, ValueError) as exc:
            try:
                stopped = windows.signaled(session.stop_event)
            except OSError:
                stopped = False
            if stopped:
                stopped = True
            else:
                error = "permission" if getattr(exc, "winerror", None) == 1223 else "component" if self._state["stage"] == "preparing" else "helper"
                self._set("error", error)
        finally:
            # Even an unexpected IPC failure must request cleanup of our helper.
            try:
                session.stop()
                if session.process:
                    windows.signaled(session.process, 5000)
            except OSError:
                pass
            with self._lock:
                if stopped:
                    self._set("off")
                self._session = None
                self._external_at = 0
                session.close()

    def stop(self) -> bool:
        with self._lock:
            if self._session:
                self._set("stopping")
                self._session.stop()
                return True
            self._set("off")
            self._external_at = 0
            return True

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self.stop()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)


if __name__ == "__main__":
    raise SystemExit(helper_main(sys.argv[2:]) if len(sys.argv) > 1 and sys.argv[1] == HELPER_FLAG else 21)
