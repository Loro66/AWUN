"""Windows IPC/elevation for Songvale's optional network helper.

Only a random session's events and its verified parent process control lifetime.
The helper runs fixed arguments from our code, never a user-supplied command.
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes as w
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from desktop.network_runtime import RELEASE, PROFILES, runtime_directory, strategy_arguments, verified_files, YOUTUBE_HOSTS

SYNCHRONIZE = 0x100000
WAIT_TIMEOUT = 258
HELPER_FLAG = "--songvale-network-helper"


class SecurityAttributes(ctypes.Structure):
    _fields_ = [("length", w.DWORD), ("descriptor", w.LPVOID), ("inherit", w.BOOL)]


class ShellExecuteInfo(ctypes.Structure):
    _fields_ = [
        ("cbSize", w.DWORD), ("fMask", w.ULONG), ("hwnd", w.HWND),
        ("lpVerb", w.LPCWSTR), ("lpFile", w.LPCWSTR), ("lpParameters", w.LPCWSTR),
        ("lpDirectory", w.LPCWSTR), ("nShow", ctypes.c_int), ("hInstApp", w.HINSTANCE),
        ("lpIDList", w.LPVOID), ("lpClass", w.LPCWSTR), ("hkeyClass", w.HANDLE),
        ("dwHotKey", w.DWORD), ("hIcon", w.HANDLE), ("hProcess", w.HANDLE),
    ]


class ProcessEntry(ctypes.Structure):
    _fields_ = [
        ("dwSize", w.DWORD), ("cntUsage", w.DWORD), ("th32ProcessID", w.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", w.DWORD),
        ("cntThreads", w.DWORD), ("th32ParentProcessID", w.DWORD),
        ("pcPriClassBase", w.LONG), ("dwFlags", w.DWORD), ("szExeFile", w.WCHAR * 260),
    ]


class JobLimits(ctypes.Structure):
    _fields_ = [
        ("per_process_time", ctypes.c_longlong), ("per_job_time", ctypes.c_longlong),
        ("flags", w.DWORD), ("min_working_set", ctypes.c_size_t),
        ("max_working_set", ctypes.c_size_t), ("active_processes", w.DWORD),
        ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD),
    ]


class ExtendedJobLimits(ctypes.Structure):
    _fields_ = [
        ("basic", JobLimits), ("io", ctypes.c_ulonglong * 6),
        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
        ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t),
    ]


class Windows:
    def __init__(self) -> None:
        if sys.platform != "win32":
            raise OSError("Windows only")
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.shell = ctypes.WinDLL("shell32", use_last_error=True)
        self.advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        self.ole = ctypes.WinDLL("ole32", use_last_error=True)
        self.ole.CoInitializeEx.argtypes = [w.LPVOID, w.DWORD]
        self.ole.CoInitializeEx.restype = ctypes.c_long
        self.ole.CoUninitialize.argtypes = []
        self.ole.CoUninitialize.restype = None
        signatures = {
            "CreateEventW": ([ctypes.POINTER(SecurityAttributes), w.BOOL, w.BOOL, w.LPCWSTR], w.HANDLE),
            "OpenEventW": ([w.DWORD, w.BOOL, w.LPCWSTR], w.HANDLE),
            "SetEvent": ([w.HANDLE], w.BOOL),
            "CloseHandle": ([w.HANDLE], w.BOOL),
            "LocalFree": ([w.HANDLE], w.HANDLE),
            "WaitForSingleObject": ([w.HANDLE, w.DWORD], w.DWORD),
            "WaitForMultipleObjects": ([w.DWORD, ctypes.POINTER(w.HANDLE), w.BOOL, w.DWORD], w.DWORD),
            "OpenProcess": ([w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
            "QueryFullProcessImageNameW": ([w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)], w.BOOL),
            "GetExitCodeProcess": ([w.HANDLE, ctypes.POINTER(w.DWORD)], w.BOOL),
            "CreateToolhelp32Snapshot": ([w.DWORD, w.DWORD], w.HANDLE),
            "Process32FirstW": ([w.HANDLE, ctypes.POINTER(ProcessEntry)], w.BOOL),
            "Process32NextW": ([w.HANDLE, ctypes.POINTER(ProcessEntry)], w.BOOL),
            "GetFileAttributesW": ([w.LPCWSTR], w.DWORD),
            "CreateJobObjectW": ([w.LPVOID, w.LPCWSTR], w.HANDLE),
            "SetInformationJobObject": ([w.HANDLE, ctypes.c_int, w.LPVOID, w.DWORD], w.BOOL),
            "AssignProcessToJobObject": ([w.HANDLE, w.HANDLE], w.BOOL),
            "CreateMutexW": ([w.LPVOID, w.BOOL, w.LPCWSTR], w.HANDLE),
            "ReleaseMutex": ([w.HANDLE], w.BOOL),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.kernel, name)
            function.argtypes, function.restype = arguments, result
        self.shell.ShellExecuteExW.argtypes = [ctypes.POINTER(ShellExecuteInfo)]
        self.shell.ShellExecuteExW.restype = w.BOOL
        self.shell.SHGetFolderPathW.argtypes = [w.HWND, ctypes.c_int, w.HANDLE, w.DWORD, w.LPWSTR]
        self.shell.SHGetFolderPathW.restype = ctypes.c_long
        self.advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [w.LPCWSTR, w.DWORD, ctypes.POINTER(w.LPVOID), ctypes.POINTER(w.DWORD)]
        self.advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = w.BOOL

    def close(self, handle) -> None:
        if handle:
            self.kernel.CloseHandle(handle)

    def signaled(self, handle, milliseconds: int = 0) -> bool:
        result = self.kernel.WaitForSingleObject(handle, milliseconds)
        if result not in (0, WAIT_TIMEOUT):
            raise ctypes.WinError(ctypes.get_last_error())
        return result == 0

    def external_process(self) -> str | None:
        snapshot = self.kernel.CreateToolhelp32Snapshot(2, 0)
        if not snapshot or snapshot == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            entry = ProcessEntry(dwSize=ctypes.sizeof(ProcessEntry))
            found = self.kernel.Process32FirstW(snapshot, ctypes.byref(entry))
            while found:
                if entry.szExeFile.casefold() in {"winws.exe", "winws2.exe", "goodbyedpi.exe"}:
                    return entry.szExeFile
                found = self.kernel.Process32NextW(snapshot, ctypes.byref(entry))
            return None
        finally:
            self.close(snapshot)

    def create_event(self, name: str):
        descriptor = w.LPVOID()
        # Current owner, SYSTEM and elevated administrators (including an admin
        # account supplied to UAC). Other local users get no control rights.
        if not self.advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            "D:P(A;;GA;;;OW)(A;;GA;;;SY)(A;;GA;;;BA)", 1, ctypes.byref(descriptor), None
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        attributes = SecurityAttributes(ctypes.sizeof(SecurityAttributes), descriptor, False)
        try:
            ctypes.set_last_error(0)
            handle = self.kernel.CreateEventW(ctypes.byref(attributes), True, False, name)
            error = ctypes.get_last_error()
            if not handle:
                raise ctypes.WinError(error)
            if error == 183:  # Never attach to somebody else's pre-existing event.
                self.close(handle)
                raise OSError("Session already exists")
            return handle
        finally:
            self.kernel.LocalFree(descriptor)

    def elevate(self, token: str, profile: str):
        arguments = [HELPER_FLAG, token, str(os.getpid()), profile]
        if not getattr(sys, "frozen", False):
            arguments = ["-m", "desktop.network_access", *arguments]
        info = ShellExecuteInfo()
        info.cbSize = ctypes.sizeof(info)
        info.fMask = 0x40 | 0x100  # Keep process handle; wait for launch on this worker thread.
        info.lpVerb, info.lpFile = "runas", sys.executable
        info.lpParameters = subprocess.list2cmdline(arguments)
        info.lpDirectory = str(Path(__file__).resolve().parents[1])
        info.nShow = 0
        # Shell verbs can use COM; this controller runs on its own worker thread.
        if self.ole.CoInitializeEx(None, 0x2 | 0x4) < 0:
            raise OSError("Shell apartment unavailable")
        try:
            if not self.shell.ShellExecuteExW(ctypes.byref(info)):
                raise ctypes.WinError(ctypes.get_last_error())
            if not info.hProcess:
                raise OSError("Helper process handle unavailable")
            return info.hProcess
        finally:
            self.ole.CoUninitialize()

    def exit_code(self, process) -> int:
        code = w.DWORD()
        if not self.kernel.GetExitCodeProcess(process, ctypes.byref(code)):
            raise ctypes.WinError(ctypes.get_last_error())
        return code.value

    def protected_directory(self) -> Path:
        buffer = ctypes.create_unicode_buffer(260)
        if self.shell.SHGetFolderPathW(None, 0x26, None, 0, buffer) != 0:
            raise OSError("Program Files unavailable")
        root = Path(buffer.value)
        target = root / "SONGVALE Network" / RELEASE
        # Reject junctions/reparse points before writing privileged files.
        for path in (root, target.parent, target):
            attributes = self.kernel.GetFileAttributesW(str(path))
            if attributes != 0xFFFFFFFF and attributes & 0x400:
                raise ValueError("Unsafe component directory")
        target.mkdir(parents=True, exist_ok=True)
        for name in (*verified_files(runtime_directory()), "youtube-hosts.txt"):
            attributes = self.kernel.GetFileAttributesW(str(target / name))
            if attributes != 0xFFFFFFFF and attributes & 0x400:
                raise ValueError("Unsafe component file")
        return target

    def parent_process(self, pid: int):
        handle = self.kernel.OpenProcess(SYNCHRONIZE | 0x1000, False, pid)
        if not handle:
            raise OSError("Parent exited")
        try:
            buffer, size = ctypes.create_unicode_buffer(32768), w.DWORD(32768)
            if not self.kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
                raise OSError("Parent identity unavailable")
            if os.path.normcase(buffer.value) != os.path.normcase(os.path.abspath(sys.executable)):
                raise ValueError("Parent executable mismatch")
            return handle
        except Exception:
            self.close(handle)
            raise

    def child_job(self, child):
        job = self.kernel.CreateJobObjectW(None, None)
        if not job:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedJobLimits()
        limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE: a crashed supervisor leaves no daemon.
        if not self.kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not self.kernel.AssignProcessToJobObject(job, int(child._handle)):
            self.close(job)
            raise ctypes.WinError(ctypes.get_last_error())
        return job


def event_name(token: str, purpose: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{32}", token) or purpose not in {"stop", "ready"}:
        raise ValueError("Invalid helper session")
    return f"Local\\SongvaleNetwork_{token}_{purpose}"


def helper_main(arguments: list[str]) -> int:
    if sys.platform != "win32" or len(arguments) != 3:
        return 21
    token, raw_pid, profile = arguments
    try:
        event_name(token, "stop")
        if profile not in PROFILES or not raw_pid.isdecimal() or not 0 < int(raw_pid) <= 0xFFFFFFFF:
            return 21
    except ValueError:
        return 21
    windows = Windows()
    handles, child, job, mutex = [], None, None, None
    try:
        parent = windows.parent_process(int(raw_pid))
        handles.append(parent)
        stop = windows.kernel.OpenEventW(SYNCHRONIZE, False, event_name(token, "stop"))
        if not stop:
            return 21
        handles.append(stop)
        ready = windows.kernel.OpenEventW(2, False, event_name(token, "ready"))
        if not ready:
            return 21
        handles.append(ready)
        wait_handles = (w.HANDLE * 2)(stop, parent)

        def finished(milliseconds=0):
            result = windows.kernel.WaitForMultipleObjects(2, wait_handles, False, milliseconds)
            if result not in (0, 1, WAIT_TIMEOUT):
                raise OSError("Session wait failed")
            return result != WAIT_TIMEOUT

        if finished():
            return 0
        ctypes.set_last_error(0)
        mutex = windows.kernel.CreateMutexW(None, True, "Global\\SongvaleYouTubeAccess_v1")
        if not mutex:
            return 24
        if ctypes.get_last_error() == 183:
            result = windows.kernel.WaitForSingleObject(mutex, 0)
            if result not in (0, 128):  # Includes recovery after a crashed owner.
                windows.close(mutex)
                mutex = None
                return 22
        if windows.external_process():
            return 22
        payloads = verified_files(runtime_directory())
        directory = windows.protected_directory()
        for name, data in payloads.items():
            (directory / name).write_bytes(data)
        (directory / "youtube-hosts.txt").write_text("\n".join(YOUTUBE_HOSTS) + "\n", encoding="ascii")
        verified_files(directory)
        if finished():
            return 0
        if windows.external_process():
            return 22
        child = subprocess.Popen(strategy_arguments(directory, profile), cwd=directory, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        job = windows.child_job(child)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if child.poll() is not None:
                return 23
            if finished(100):
                return 0
        if not windows.kernel.SetEvent(ready):
            return 24
        while not finished(300):
            if child.poll() is not None:
                return 23
        return 0
    except (OSError, ValueError):
        return 24
    finally:
        if child and child.poll() is None:
            child.terminate()  # Only the child created by this particular helper.
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=2)
        windows.close(job)
        if mutex:
            windows.kernel.ReleaseMutex(mutex)
            windows.close(mutex)
        for handle in reversed(handles):
            windows.close(handle)
