import sys
from pathlib import Path

_VENDOR_DIR = Path(__file__).parent.resolve()
if str(_VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(_VENDOR_DIR))
