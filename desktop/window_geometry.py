"""Choose a usable initial window on small screens and scaled Windows displays."""

import os


def fit_window_size(width: int, height: int) -> tuple[int, int]:
    return min(1440, max(440, width - 48)), min(900, max(300, height - 48))


def initial_window_size() -> tuple[int, int]:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        area = wintypes.RECT()
        if ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(area), 0):
            return fit_window_size(area.right - area.left, area.bottom - area.top)
    return 1200, 780
