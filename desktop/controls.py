"""Windows notification icon and registered shortcuts; no keyboard hooks."""

from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import threading


# CTRL + ALT; Windows delivers WM_HOTKEY only for these combinations.
HOTKEYS = {
    1: (0x20, "play_pause", "Ctrl+Alt+Space"),
    2: (0x25, "previous", "Ctrl+Alt+Left"),
    3: (0x27, "next", "Ctrl+Alt+Right"),
    4: (0x26, "volume_up", "Ctrl+Alt+Up"),
    5: (0x28, "volume_down", "Ctrl+Alt+Down"),
    6: (0x4D, "mini", "Ctrl+Alt+M"),
    7: (0x53, "show", "Ctrl+Alt+S"),
}
PLAYER_ACTIONS = {"play_pause", "previous", "next", "volume_up", "volume_down", "mini"}


class DesktopControls:
    def __init__(self, window, preferences_path: Path, icon_path: Path, native_factory=None):
        self.window = window
        self.preferences_path = preferences_path
        self.icon_path = icon_path
        self.mini = False
        self.quitting = False
        self._geometry = None
        self._lock = threading.RLock()
        self.preferences = {"hotkeys": True, "close_to_tray": True}
        try:
            stored = json.loads(preferences_path.read_text(encoding="utf-8"))
            self.preferences.update({key: stored[key] for key in self.preferences if isinstance(stored.get(key), bool)})
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        self.native = (native_factory or WindowsIntegration)(self) if native_factory or os.name == "nt" else None
        self._commands = queue.Queue()
        self._worker = threading.Thread(target=self._dispatch_loop, name="songvale-controls", daemon=True)
        self._worker.start()

    def start(self):
        if self.native:
            self.native.start()

    def status(self):
        return {
            "supported": self.native is not None,
            "tray": bool(self.native and self.native.tray),
            "mini": self.mini,
            **self.preferences,
            "shortcuts": [
                {"action": action, "keys": keys, "active": bool(self.native and identifier in self.native.registered)}
                for identifier, (_, action, keys) in HOTKEYS.items()
            ],
        }

    def configure(self, hotkeys: bool, close_to_tray: bool):
        if not isinstance(hotkeys, bool) or not isinstance(close_to_tray, bool):
            return False
        with self._lock:
            new = {"hotkeys": hotkeys, "close_to_tray": close_to_tray}
            try:
                self.preferences_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.preferences_path.with_suffix(".tmp")
                temporary.write_text(json.dumps(new), encoding="utf-8")
                temporary.replace(self.preferences_path)
            except OSError:
                return False
            self.preferences = new
            if self.native:
                self.native.configure_hotkeys(hotkeys)
        return True

    def set_mini(self, enabled: bool, video: bool = False):
        if not isinstance(enabled, bool) or not isinstance(video, bool):
            return False
        with self._lock:
            if enabled and not self.mini:
                self.window.restore()
                self._geometry = (self.window.width, self.window.height, self.window.x, self.window.y)
            if enabled:
                self.window.on_top = True
                # YouTube keeps its visible official player at least 200px high.
                self.window.resize(460, 540 if video else 300)
            elif self.mini:
                self.window.on_top = False
                width, height, x, y = self._geometry or (1440, 900, None, None)
                self.window.resize(width, height)
                if x is not None and y is not None:
                    self.window.move(x, y)
            self.mini = enabled
        return True

    def enqueue(self, action):
        if action in PLAYER_ACTIONS | {"show", "hide", "quit", "status"} and not self.quitting:
            self._commands.put(action)
            return True
        return False

    def _dispatch_loop(self):
        while True:
            action = self._commands.get()
            if action is None:
                return
            try:
                if action == "quit":
                    self.quitting = True
                    self.window.destroy()
                elif action == "hide":
                    if self.native and self.native.tray:
                        self.window.hide()
                elif action == "show":
                    self.window.show()
                    self.window.restore()
                else:
                    self.window.run_js("window.dispatchEvent(new CustomEvent('songvale:desktop-command'," + json.dumps({"detail": {"action": action}}) + "))")
            except Exception:
                # A shortcut during loading/exit must not kill the message loop.
                pass

    def closing(self):
        if not self.quitting and self.preferences["close_to_tray"] and self.native and self.native.tray:
            self.window.hide()
            return False
        return True

    def stop(self):
        self.quitting = True
        if self.native:
            self.native.stop()
        self._commands.put(None)


class WindowsIntegration:
    """Own hidden window/message loop, with pointer-sized Win32 prototypes."""

    def __init__(self, owner):
        self.owner = owner
        self.tray = False
        self.registered = set()
        self.hwnd = None
        self._thread = None
        self._ready = threading.Event()
        self._stopping = threading.Event()

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="songvale-win32", daemon=True)
        self._thread.start()

    def configure_hotkeys(self, enabled):
        if self.hwnd:
            self.user.PostMessageW(self.hwnd, 0x8002, int(enabled), 0)

    def stop(self):
        self._stopping.set()
        if self.hwnd:
            self.user.PostMessageW(self.hwnd, 0x0010, 0, 0)
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=3)

    def _run(self):
        try:
            self._message_loop()
        except Exception:
            self.owner.enqueue("status")
        finally:
            self.tray = False
            self.registered.clear()
            self.hwnd = None
            self._ready.set()

    def _message_loop(self):
        import ctypes as c
        from ctypes import wintypes as w

        self.user = user = c.WinDLL("user32", use_last_error=True)
        shell = c.WinDLL("shell32", use_last_error=True)
        kernel = c.WinDLL("kernel32", use_last_error=True)
        result_type = c.c_ssize_t
        callback_type = c.WINFUNCTYPE(result_type, w.HWND, w.UINT, w.WPARAM, w.LPARAM)

        class WindowClass(c.Structure):
            _fields_ = [("style", w.UINT), ("proc", callback_type), ("class_extra", c.c_int), ("window_extra", c.c_int), ("instance", w.HINSTANCE), ("icon", w.HICON), ("cursor", w.HANDLE), ("brush", w.HBRUSH), ("menu", w.LPCWSTR), ("name", w.LPCWSTR)]

        class Guid(c.Structure):
            _fields_ = [("a", w.DWORD), ("b", w.WORD), ("d", w.WORD), ("e", c.c_ubyte * 8)]

        class IconData(c.Structure):
            _fields_ = [("size", w.DWORD), ("hwnd", w.HWND), ("id", w.UINT), ("flags", w.UINT), ("message", w.UINT), ("icon", w.HICON), ("tip", w.WCHAR * 128), ("state", w.DWORD), ("state_mask", w.DWORD), ("info", w.WCHAR * 256), ("version", w.UINT), ("info_title", w.WCHAR * 64), ("info_flags", w.DWORD), ("guid", Guid), ("balloon", w.HICON)]

        def prototype(dll, name, returns, *args):
            function = getattr(dll, name)
            function.restype, function.argtypes = returns, args
            return function

        prototype(kernel, "GetModuleHandleW", w.HMODULE, w.LPCWSTR)
        prototype(user, "RegisterClassW", w.ATOM, c.POINTER(WindowClass))
        prototype(user, "UnregisterClassW", w.BOOL, w.LPCWSTR, w.HINSTANCE)
        prototype(user, "CreateWindowExW", w.HWND, w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD, c.c_int, c.c_int, c.c_int, c.c_int, w.HWND, w.HMENU, w.HINSTANCE, c.c_void_p)
        prototype(user, "DefWindowProcW", result_type, w.HWND, w.UINT, w.WPARAM, w.LPARAM)
        prototype(user, "PostMessageW", w.BOOL, w.HWND, w.UINT, w.WPARAM, w.LPARAM)
        prototype(user, "GetMessageW", w.BOOL, c.POINTER(w.MSG), w.HWND, w.UINT, w.UINT)
        prototype(user, "TranslateMessage", w.BOOL, c.POINTER(w.MSG))
        prototype(user, "DispatchMessageW", result_type, c.POINTER(w.MSG))
        prototype(user, "PostQuitMessage", None, c.c_int)
        prototype(user, "DestroyWindow", w.BOOL, w.HWND)
        prototype(user, "RegisterHotKey", w.BOOL, w.HWND, c.c_int, w.UINT, w.UINT)
        prototype(user, "UnregisterHotKey", w.BOOL, w.HWND, c.c_int)
        prototype(user, "RegisterWindowMessageW", w.UINT, w.LPCWSTR)
        prototype(user, "LoadImageW", w.HANDLE, w.HINSTANCE, w.LPCWSTR, w.UINT, c.c_int, c.c_int, w.UINT)
        prototype(user, "LoadIconW", w.HICON, w.HINSTANCE, c.c_void_p)
        prototype(user, "DestroyIcon", w.BOOL, w.HICON)
        prototype(user, "CreatePopupMenu", w.HMENU)
        prototype(user, "AppendMenuW", w.BOOL, w.HMENU, w.UINT, c.c_size_t, w.LPCWSTR)
        prototype(user, "TrackPopupMenu", w.UINT, w.HMENU, w.UINT, c.c_int, c.c_int, c.c_int, w.HWND, c.c_void_p)
        prototype(user, "DestroyMenu", w.BOOL, w.HMENU)
        prototype(user, "GetCursorPos", w.BOOL, c.POINTER(w.POINT))
        prototype(user, "SetForegroundWindow", w.BOOL, w.HWND)
        prototype(shell, "Shell_NotifyIconW", w.BOOL, w.DWORD, c.POINTER(IconData))
        taskbar_created = user.RegisterWindowMessageW("TaskbarCreated")
        icon = user.LoadImageW(None, str(self.owner.icon_path), 1, 0, 0, 0x0010 | 0x0040)
        owned_icon = bool(icon)
        icon = icon or user.LoadIconW(None, c.c_void_p(32512))
        data = IconData()
        data.size, data.id, data.flags, data.message, data.icon = c.sizeof(data), 1, 0x0087, 0x8001, icon
        data.tip, data.version = "SONGVALE — музыка рядом", 4

        def add_icon():
            self.tray = bool(shell.Shell_NotifyIconW(0, c.byref(data)))
            if self.tray:
                shell.Shell_NotifyIconW(4, c.byref(data))
            self.owner.enqueue("status")

        def register_hotkeys(enabled):
            for identifier in list(self.registered):
                user.UnregisterHotKey(self.hwnd, identifier)
            self.registered.clear()
            if enabled:
                for identifier, (key, _, _) in HOTKEYS.items():
                    if user.RegisterHotKey(self.hwnd, identifier, 0x4003, key):
                        self.registered.add(identifier)
            self.owner.enqueue("status")

        actions = [("show", "Открыть SONGVALE"), ("play_pause", "Играть / пауза"), ("previous", "Предыдущий трек"), ("next", "Следующий трек"), ("mini", "Мини-плеер / полное окно"), ("quit", "Выйти из SONGVALE")]

        def menu():
            popup = user.CreatePopupMenu()
            try:
                for identifier, (_, title) in enumerate(actions, 1):
                    user.AppendMenuW(popup, 0, identifier, title)
                point = w.POINT()
                user.GetCursorPos(c.byref(point))
                user.SetForegroundWindow(self.hwnd)
                selected = user.TrackPopupMenu(popup, 0x0102, point.x, point.y, 0, self.hwnd, None)
                if 1 <= selected <= len(actions):
                    self.owner.enqueue(actions[selected - 1][0])
                user.PostMessageW(self.hwnd, 0, 0, 0)
                shell.Shell_NotifyIconW(3, c.byref(data))
            finally:
                user.DestroyMenu(popup)

        @callback_type
        def procedure(hwnd, message, wp, lp):
            if message == 0x0312 and int(wp) in HOTKEYS:
                self.owner.enqueue(HOTKEYS[int(wp)][1])
                return 0
            if message == 0x8001:
                event = int(lp) & 0xFFFF
                if event in {0x0202, 0x0203, 0x0400, 0x0401}:
                    self.owner.enqueue("show")
                elif event in {0x007B, 0x0205}:
                    menu()
                return 0
            if message == 0x8002:
                register_hotkeys(bool(wp))
                return 0
            if message == taskbar_created:
                add_icon()
                return 0
            if message == 0x0010:
                user.DestroyWindow(hwnd)
                return 0
            if message == 0x0002:
                user.PostQuitMessage(0)
                return 0
            return user.DefWindowProcW(hwnd, message, wp, lp)

        instance = kernel.GetModuleHandleW(None)
        name = f"SONGVALE.Controls.{os.getpid()}.{id(self)}"
        cls = WindowClass(proc=procedure, instance=instance, name=name)
        if not user.RegisterClassW(c.byref(cls)):
            raise c.WinError(c.get_last_error())
        try:
            self.hwnd = user.CreateWindowExW(0, name, "SONGVALE controls", 0, 0, 0, 0, 0, None, None, instance, None)
            if not self.hwnd:
                raise c.WinError(c.get_last_error())
            data.hwnd = self.hwnd
            if self._stopping.is_set():
                return
            add_icon()
            register_hotkeys(self.owner.preferences["hotkeys"])
            self._ready.set()
            message = w.MSG()
            while user.GetMessageW(c.byref(message), None, 0, 0) > 0:
                user.TranslateMessage(c.byref(message))
                user.DispatchMessageW(c.byref(message))
        finally:
            register_hotkeys(False)
            shell.Shell_NotifyIconW(2, c.byref(data))
            if self.hwnd:
                user.DestroyWindow(self.hwnd)
            user.UnregisterClassW(name, instance)
            if owned_icon:
                user.DestroyIcon(icon)
