"""Utilities for downloading remote media URLs to local temp files for publishing."""

import base64
import os
import re
import uuid
from pathlib import Path

import requests

TEMP_DIR = Path("temp")


def _is_url(path: str) -> bool:
    return path.startswith(("http://", "https://", "data:"))


def resolve_to_local(url: str, temp_paths: list[str]) -> str:
    if not url or not _is_url(url):
        return url

    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    if url.startswith("data:"):
        m = re.match(r"data:(image|video)/(\w+);base64,", url)
        ext = f".{m.group(2)}" if m else ".bin"
        _, encoded = url.split(",", 1)
        data = base64.b64decode(encoded)
    else:
        ext = os.path.splitext(url.split("?")[0])[1] or ".bin"
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        data = resp.content

    local_path = str(TEMP_DIR / f"{uuid.uuid4().hex}{ext}")
    with open(local_path, "wb") as f:
        f.write(data)
    temp_paths.append(local_path)
    return local_path


def cleanup_temp_files(paths: list[str]):
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass
