from pathlib import Path
import sys

import pytest


PACKAGE_PARENT = Path(__file__).resolve().parent
if str(PACKAGE_PARENT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_PARENT))


@pytest.fixture(autouse=True)
def _clear_module_caches():
    """Reset module-level caches before each test to prevent cross-test contamination."""
    try:
        from backend.api.video_edit_api import _ASR_CACHE

        _ASR_CACHE.clear()
    except ImportError:
        pass
    try:
        from backend.api.hot_video_api import _ASR_CACHE as _HOT_VIDEO_ASR_CACHE
        from backend.api.hot_video_api import _ANALYSIS_CACHE

        _HOT_VIDEO_ASR_CACHE.clear()
        _ANALYSIS_CACHE.clear()
    except ImportError:
        pass
    yield
