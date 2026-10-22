"""Small local startup log for failures before a usable application window."""

import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import sys

logger = logging.getLogger("songvale.desktop")


def install_startup_diagnostics():
    directory = Path(os.getenv("LOCALAPPDATA") or os.getenv("APPDATA") or Path.home()) / "SONGVALE" / "logs"
    path = directory / "desktop.log"
    try:
        directory.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(path, maxBytes=2*1024*1024, backupCount=2, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
        logging.getLogger("pywebview").addHandler(handler)
        logger.setLevel(logging.INFO)
    except OSError:
        logger.addHandler(logging.NullHandler())

    def failed(kind, value, trace):
        logger.error("Desktop startup failed", exc_info=(kind, value, trace))
        if os.name == "nt" and os.getenv("SONGVALE_DIAGNOSTIC_NO_DIALOG") != "1":
            import ctypes
            ctypes.windll.user32.MessageBoxW(None,
                "Не удалось запустить SONGVALE.\nПерезапусти приложение или установи последнюю версию.\n\n"
                f"Подробности сохранены в:\n{path}", "SONGVALE", 0x10)
    sys.excepthook = failed
    logger.info("Desktop process starting")
