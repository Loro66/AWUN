import json
import os
from pathlib import Path
import threading
from types import SimpleNamespace

import pytest

from desktop.controls import DesktopControls, HOTKEYS, WindowsIntegration


class Window:
    width, height, x, y, on_top = 1440, 900, 100, 80, False

    def __init__(self):
        self.hidden = False
        self.destroyed = False
        self.script = None
        self.called = threading.Event()

    def resize(self, width, height):
        self.width, self.height = width, height

    def move(self, x, y):
        self.x, self.y = x, y

    def restore(self):
        pass

    def hide(self):
        self.hidden = True

    def show(self):
        self.hidden = False

    def run_js(self, script):
        self.script = script
        self.called.set()

    def destroy(self):
        self.destroyed = True
        self.called.set()


class Native:
    def __init__(self, owner):
        self.tray = True
        self.registered = {1, 2}

    def start(self):
        pass

    def configure_hotkeys(self, enabled):
        self.registered = set(HOTKEYS) if enabled else set()

    def stop(self):
        self.tray = False


def test_mini_preserves_geometry_and_current_player(tmp_path):
    window = Window()
    controls = DesktopControls(window, tmp_path / 'prefs.json', Path('icon'), Native)
    try:
        assert controls.set_mini(True)
        assert (window.width, window.height, window.on_top) == (460, 300, True)
        assert controls.set_mini(True, video=True)
        assert window.height == 540
        assert controls.set_mini(False)
        assert (window.width, window.height, window.x, window.y, window.on_top) == (1440, 900, 100, 80, False)
        assert window.script is None  # No navigation or second player.
    finally:
        controls.stop()


def test_close_hides_only_when_tray_is_available_and_explicit_quit_exits(tmp_path):
    window = Window()
    controls = DesktopControls(window, tmp_path / 'prefs.json', Path('icon'), Native)
    try:
        assert controls.closing() is False and window.hidden
        controls.native.tray = False
        assert controls.closing() is True
        controls.native.tray = True
        assert controls.enqueue('quit')
        assert window.called.wait(2)
        assert window.destroyed and controls.closing() is True
    finally:
        controls.stop()


def test_hotkey_conflicts_reported_and_preferences_survive_restart(tmp_path):
    path = tmp_path / 'prefs.json'
    controls = DesktopControls(Window(), path, Path('icon'), Native)
    try:
        assert len([item for item in controls.status()['shortcuts'] if not item['active']]) == 5
        assert controls.configure(False, False)
        assert controls.native.registered == set()
        assert json.loads(path.read_text()) == {'hotkeys': False, 'close_to_tray': False}
        assert controls.configure('true', True) is False
    finally:
        controls.stop()
    restored = DesktopControls(Window(), path, Path('icon'), Native)
    try:
        assert restored.preferences == {'hotkeys': False, 'close_to_tray': False}
    finally:
        restored.stop()


def test_native_commands_are_allowlisted_and_dispatch_without_blocking_message_loop(tmp_path):
    window = Window()
    controls = DesktopControls(window, tmp_path / 'prefs.json', Path('icon'), Native)
    try:
        assert controls.enqueue('arbitrary script') is False
        assert controls.enqueue('next')
        assert window.called.wait(2)
        assert 'songvale:desktop-command' in window.script and 'next' in window.script
    finally:
        controls.stop()


@pytest.mark.skipif(os.name != 'nt', reason='Real Windows message loop')
def test_real_windows_loop_registers_and_releases_hotkeys(tmp_path):
    window = Window()
    controls = DesktopControls(window, tmp_path / 'prefs.json', Path(__file__).parents[1] / 'desktop/assets/songvale.ico')
    try:
        controls.start()
        assert controls.native._ready.wait(5)
        assert controls.native.hwnd, 'Win32 control window was not created'
        assert controls.native.registered
        window.called.clear()
        controls.native.user.PostMessageW(controls.native.hwnd, 0x0312, next(iter(controls.native.registered)), 0)
        assert window.called.wait(2)
    finally:
        controls.stop()
    assert controls.native.hwnd is None and not controls.native.registered
