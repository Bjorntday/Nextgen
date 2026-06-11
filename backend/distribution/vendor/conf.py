import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.resolve()

_STR_VALUE = os.environ.get("LOCAL_CHROME_PATH", "") or ""
LOCAL_CHROME_PATH = _STR_VALUE

_BOOL_VALUE = os.environ.get("PUBLISH_HEADLESS", "true") or "true"
LOCAL_CHROME_HEADLESS = _BOOL_VALUE.lower() in ("1", "true", "yes")

DEBUG_MODE = os.environ.get("DEBUG", "0") or "0"
DEBUG_MODE = DEBUG_MODE.lower() in ("1", "true", "yes")

COOKIES_DIR = os.environ.get("PUBLISH_COOKIES_DIR", "") or ""
if not COOKIES_DIR:
    COOKIES_DIR = str(BASE_DIR.parent / "cookies")
