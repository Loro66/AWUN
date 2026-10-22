"""Atomic desktop snapshots with a last-known-good recovery copy."""

import json
import os
from pathlib import Path
import tempfile
import threading

MAX_DESKTOP_STATE_BYTES = 4 * 1024 * 1024
TRANSIENT_DESKTOP_STATE_KEYS = {
    "awun-waveforms-v1", "awun-search-cache-v1", "awun-runtime-log-v1", "awun-catalog-cache-v1",
}


def persistent_state_key(key: str) -> bool:
    return (
        key.startswith("awun-") and key not in TRANSIENT_DESKTOP_STATE_KEYS
        or key in {"songvale-account-owner-v1", "songvale-backup-restore-pending-v1",
                   "songvale-source-preferences-v1", "songvale-transitions-v1"}
        or key.startswith("songvale-account-sync-")
    )


def decode_state(raw: str) -> dict[str, str]:
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_DESKTOP_STATE_BYTES:
        raise ValueError("Desktop snapshot exceeds its size limit")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Desktop snapshot is not an object")
    safe = {}
    for key, value in data.items():
        if persistent_state_key(key):
            if not isinstance(value, str):
                raise ValueError("Desktop storage values must be strings")
            safe[key] = value
    return safe


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=path.name + ".", suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


class DesktopStateStore:
    def __init__(self, state_path: Path | None = None) -> None:
        self.legacy_state_path = None
        if state_path is None:
            app_data = os.getenv("APPDATA")
            state_path = (Path(app_data) / "SONGVALE" if app_data else Path.home() / ".songvale") / "desktop-state.json"
            self.legacy_state_path = (Path(app_data) / "AWUN" if app_data else Path.home() / ".awun") / "desktop-state.json"
        self.state_path = state_path
        self._lock = threading.RLock()
        self._last_good_state = None
        self._read_failed = False
        self._recovered = False

    def _read_file(self, path: Path) -> dict[str, str]:
        with path.open("rb") as source:
            raw = source.read(MAX_DESKTOP_STATE_BYTES + 1)
        if len(raw) > MAX_DESKTOP_STATE_BYTES:
            raise ValueError("Desktop snapshot exceeds its size limit")
        return decode_state(raw.decode("utf-8"))

    def load_state(self) -> str:
        with self._lock:
            source = self.state_path
            backup = source.with_suffix(".bak")
            if not source.exists() and not backup.exists() and self.legacy_state_path:
                source = self.legacy_state_path
                backup = source.with_suffix(".bak")
            found = False
            for candidate in (source, backup):
                if not candidate.exists():
                    continue
                found = True
                try:
                    safe = self._read_file(candidate)
                    self._last_good_state = json.dumps(safe, ensure_ascii=False, separators=(",", ":"))
                    self._read_failed = False
                    self._recovered = candidate == backup
                    return self._last_good_state
                except (OSError, ValueError, TypeError):
                    continue
            if found:
                self._read_failed = True
                raise OSError("Медиатеку не удалось прочитать. Исходные файлы сохранены; повтори восстановление.")
            self._read_failed = False
            self._last_good_state = "{}"
            return "{}"

    def save_state(self, payload: str) -> bool:
        try:
            encoded = json.dumps(decode_state(payload), ensure_ascii=False, separators=(",", ":"))
        except (ValueError, TypeError, UnicodeError):
            return False
        if len(encoded.encode("utf-8")) > MAX_DESKTOP_STATE_BYTES:
            return False
        with self._lock:
            if self._read_failed:
                return False
            try:
                if self.state_path.exists():
                    try:
                        previous = json.dumps(self._read_file(self.state_path), ensure_ascii=False, separators=(",", ":"))
                    except (OSError, ValueError, TypeError):
                        if self._last_good_state is None:
                            return False
                        previous = self._last_good_state
                    if previous == encoded and not self._recovered:
                        return True
                    atomic_write(self.state_path.with_suffix(".bak"), previous)
                elif self._last_good_state and self._last_good_state != "{}":
                    atomic_write(self.state_path.with_suffix(".bak"), self._last_good_state)
                atomic_write(self.state_path, encoded)
                self._last_good_state = encoded
                self._recovered = False
                return True
            except OSError:
                return False

    def desktop_storage_status(self) -> dict:
        with self._lock:
            return {"recovered": self._recovered, "read_error": self._read_failed}
