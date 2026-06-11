from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from backend.distribution import vendor  # noqa: F401
from backend.distribution.vendor.conf import COOKIES_DIR
from backend.distribution.vendor.utils.log import (
    douyin_logger,
    kuaishou_logger,
    xiaohongshu_logger,
    tencent_logger,
    bilibili_logger,
)

_PLATFORM_LOGGER = {
    "douyin": douyin_logger,
    "kuaishou": kuaishou_logger,
    "xhs": xiaohongshu_logger,
    "xiaohongshu": xiaohongshu_logger,
    "tencent": tencent_logger,
    "wechat_channels": tencent_logger,
    "bilibili": bilibili_logger,
}


def _platform_logger(platform: str):
    return _PLATFORM_LOGGER.get(platform, douyin_logger)


_LOGIN_SESSIONS: dict[str, dict] = {}
_LOGIN_LOCK = threading.Lock()


def _cookies_dir() -> Path:
    path = Path(COOKIES_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def account_file_path(platform: str, account: str) -> str:
    return str(_cookies_dir() / f"{platform}_{account}.json")


def _manifest_path() -> Path:
    return _cookies_dir() / "accounts.json"


def load_manifest() -> dict:
    mpath = _manifest_path()
    if mpath.exists():
        try:
            return json.loads(mpath.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"version": 1, "updated_at": "", "platforms": {}, "accounts": []}


def save_manifest(manifest: dict):
    manifest["version"] = 1
    manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
    _manifest_path().write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def get_platform_headless(platform: str) -> bool:
    manifest = load_manifest()
    return manifest.get("platforms", {}).get(platform, {}).get("headless", True)


def set_platform_headless(platform: str, headless: bool):
    manifest = load_manifest()
    manifest.setdefault("platforms", {})
    manifest["platforms"][platform] = {"headless": headless}
    save_manifest(manifest)


def add_account(platform: str, account: str, valid: bool = False, cookie_path: str = "", **extra):
    manifest = load_manifest()
    manifest.setdefault("platforms", {})
    if platform not in manifest["platforms"]:
        manifest["platforms"][platform] = {"headless": True}
    manifest.setdefault("accounts", [])
    manifest["accounts"] = [a for a in manifest["accounts"]
                            if not (a["platform"] == platform and a["account"] == account)]
    manifest["accounts"].append({
        "platform": platform,
        "account": account,
        "valid": valid,
        "expires_at": extra.get("expires_at", ""),
        "cookie_path": cookie_path or account_file_path(platform, account),
        "created_at": extra.get("created_at", datetime.now(timezone.utc).isoformat()),
        "last_used": extra.get("last_used", ""),
    })
    save_manifest(manifest)


def remove_account_entry(platform: str, account: str):
    manifest = load_manifest()
    manifest["accounts"] = [a for a in manifest.get("accounts", [])
                            if not (a["platform"] == platform and a["account"] == account)]
    save_manifest(manifest)


def list_accounts() -> list[dict]:
    manifest = load_manifest()
    accounts = manifest.get("accounts", [])
    platforms = manifest.get("platforms", {})
    for acc in accounts:
        p = acc["platform"]
        acc["headless"] = platforms.get(p, {}).get("headless", True)
        acc["last_used"] = acc.get("last_used", "")
    return accounts


def remove_account(platform: str, account: str) -> bool:
    path = Path(account_file_path(platform, account))
    removed = False
    if path.exists():
        path.unlink()
        removed = True
    config_path = path.with_suffix(".config.json")
    if config_path.exists():
        config_path.unlink()
    remove_account_entry(platform, account)
    return removed


def get_account_config(platform: str, account: str) -> dict:
    return {"headless": get_platform_headless(platform)}


def save_account_config(platform: str, account: str, config: dict):
    if "headless" in config:
        set_platform_headless(platform, bool(config["headless"]))


async def check_auth(platform: str, account: str) -> dict:
    af = account_file_path(platform, account)
    if not os.path.exists(af):
        return {"valid": False, "error": "cookie_not_found", "message": "账号未登录，请先添加账号"}

    try:
        if platform == "douyin":
            from backend.distribution.vendor.uploader.douyin_uploader.main import cookie_auth as _check
        elif platform == "kuaishou":
            from backend.distribution.vendor.uploader.ks_uploader.main import cookie_auth as _check
        elif platform == "xhs":
            from backend.distribution.vendor.uploader.xiaohongshu_uploader.main import cookie_auth as _check
        elif platform == "tencent" or platform == "wechat_channels":
            from backend.distribution.vendor.uploader.tencent_uploader.main import cookie_auth as _check
        elif platform == "bilibili":
            from backend.distribution.vendor.uploader.bilibili_uploader.runtime import run_biliup_command
            result = run_bilibili_auth_check(account)
            return result
        else:
            return {"valid": False, "error": "unknown_platform"}

        valid = await _check(af)
        return {"valid": valid, "error": "" if valid else "cookie_invalid",
                "message": "Cookie 有效" if valid else "Cookie 已失效，请重新登录"}
    except Exception as exc:
        return {"valid": False, "error": "check_failed", "message": str(exc)}


def run_bilibili_auth_check(account: str) -> dict:
    try:
        from backend.distribution.vendor.uploader.bilibili_uploader.runtime import run_biliup_command
        af = account_file_path("bilibili", account)
        if not os.path.exists(af):
            return {"valid": False, "error": "cookie_not_found", "message": "B站账号未登录"}
        result = run_biliup_command(["-u", af, "info"])
        valid = result.returncode == 0
        return {"valid": valid, "error": "" if valid else "cookie_invalid",
                "message": "Cookie 有效" if valid else "Cookie 已失效"}
    except Exception as exc:
        return {"valid": False, "error": "check_failed", "message": str(exc)}


async def login_interactive(platform: str, account: str, headless: bool = False) -> dict:
    session_id = f"{platform}_{account}_{int(time.time())}"
    af = account_file_path(platform, account)
    Path(af).parent.mkdir(parents=True, exist_ok=True)

    qrcode_info = {}

    async def qrcode_callback(payload: dict):
        nonlocal qrcode_info
        qrcode_info = payload

    with _LOGIN_LOCK:
        _LOGIN_SESSIONS[session_id] = {"status": "starting", "qrcode": None, "account_file": af}

    try:
        if platform == "douyin":
            from backend.distribution.vendor.uploader.douyin_uploader.main import douyin_cookie_gen
            result = await douyin_cookie_gen(af, qrcode_callback=qrcode_callback, headless=headless)
        elif platform == "kuaishou":
            from backend.distribution.vendor.uploader.ks_uploader.main import get_ks_cookie
            result = await get_ks_cookie(af, qrcode_callback=qrcode_callback, headless=headless)
        elif platform == "xhs":
            from backend.distribution.vendor.uploader.xiaohongshu_uploader.main import xiaohongshu_cookie_gen
            result = await xiaohongshu_cookie_gen(af, qrcode_callback=qrcode_callback, headless=headless)
        elif platform == "tencent" or platform == "wechat_channels":
            from backend.distribution.vendor.uploader.tencent_uploader.main import tencent_cookie_gen
            result = await tencent_cookie_gen(af, qrcode_callback=qrcode_callback, headless=headless)
        elif platform == "bilibili":
            from backend.distribution.vendor.uploader.bilibili_uploader.runtime import run_biliup_command, ensure_biliup_binary
            ensure_biliup_binary()
            proc = run_biliup_command(["-u", af, "login"], interactive=True)
            success = proc.returncode == 0
            result = {"success": success, "status": "success" if success else "failed",
                      "message": "B站登录成功" if success else "B站登录失败",
                      "account_file": af, "qrcode": None, "current_url": ""}
        else:
            with _LOGIN_LOCK:
                _LOGIN_SESSIONS[session_id] = {"status": "failed", "error": "unknown_platform"}
            return {"success": False, "session_id": session_id, "error": "unknown_platform"}

        if platform != "bilibili":
            _LOGIN_SESSIONS[session_id] = {
                "status": "done" if result.get("success") else "failed",
                "qrcode": result.get("qrcode") or qrcode_info,
                "account_file": af,
                "error": result.get("message", ""),
            }

        return {
            "success": result.get("success", False),
            "session_id": session_id,
            "account_file": af,
            "qrcode": result.get("qrcode") or qrcode_info,
            "message": result.get("message", ""),
        }
    except Exception as exc:
        with _LOGIN_LOCK:
            _LOGIN_SESSIONS[session_id] = {"status": "failed", "error": str(exc)}
        return {"success": False, "session_id": session_id, "error": str(exc)}


def get_login_session_status(session_id: str) -> dict | None:
    with _LOGIN_LOCK:
        return _LOGIN_SESSIONS.get(session_id)


def cancel_login_session(session_id: str) -> bool:
    with _LOGIN_LOCK:
        if session_id in _LOGIN_SESSIONS:
            _LOGIN_SESSIONS[session_id]["status"] = "cancelled"
            return True
        return False
