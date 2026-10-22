"""One desktop player per user/session; a second launch activates its window."""

import hashlib
import os
from pathlib import Path


def profile_directory() -> Path:
    return Path(os.environ["APPDATA"]) / "SONGVALE" if os.getenv("APPDATA") else Path.home() / ".songvale"


def scope_id(directory: Path) -> str:
    return hashlib.sha256(os.path.normcase(str(directory.resolve())).encode("utf-8")).hexdigest()[:24]


def activation_message(directory: Path) -> str:
    return "SONGVALE.Activate." + scope_id(directory)


class SingleInstance:
    def __init__(self, directory: Path | None = None):
        self.directory = directory or profile_directory()
        self._handle = None
        self._kernel = None

    def acquire(self) -> bool:
        if os.name != "nt":
            return True
        import ctypes as c
        from ctypes import wintypes as w
        kernel = c.WinDLL("kernel32", use_last_error=True)
        kernel.CreateMutexW.argtypes = [c.c_void_p, w.BOOL, w.LPCWSTR]
        kernel.CreateMutexW.restype = w.HANDLE
        kernel.CloseHandle.argtypes = [w.HANDLE]
        kernel.CloseHandle.restype = w.BOOL
        c.set_last_error(0)
        handle = kernel.CreateMutexW(None, False, "Local\\SONGVALE.Desktop." + scope_id(self.directory))
        error = c.get_last_error()
        if not handle:
            raise c.WinError(error)
        if error == 183:  # ERROR_ALREADY_EXISTS
            kernel.CloseHandle(handle)
            return False
        self._handle, self._kernel = handle, kernel
        return True

    def activate_existing(self) -> None:
        if os.name != "nt":
            return
        import ctypes as c
        from ctypes import wintypes as w
        user = c.WinDLL("user32", use_last_error=True)
        user.RegisterWindowMessageW.argtypes = [w.LPCWSTR]
        user.RegisterWindowMessageW.restype = w.UINT
        user.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
        user.PostMessageW.restype = w.BOOL
        user.PostMessageW(0xFFFF, user.RegisterWindowMessageW(activation_message(self.directory)), 0, 0)

    def close(self) -> None:
        if self._handle:
            self._kernel.CloseHandle(self._handle)
            self._handle = None
