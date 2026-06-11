from __future__ import annotations

from datetime import datetime
from pathlib import Path

from backend.distribution import vendor  # noqa: F401
from backend.distribution.vendor.uploader.bilibili_uploader.runtime import (
    ensure_biliup_binary,
    run_biliup_command,
)


class BilibiliAdapter:
    def __init__(self, account_file: str, headless: bool = True):
        self.account_file = account_file
        self.headless = headless

    async def check_auth(self) -> bool:
        try:
            result = run_biliup_command(["-u", self.account_file, "info"])
            return result.returncode == 0
        except Exception:
            return False

    async def upload_video(
        self,
        video_path: str,
        title: str,
        description: str = "",
        tags: list[str] | None = None,
        schedule_time: str = "",
        thumbnail: str = "",
    ) -> dict:
        ensure_biliup_binary()

        args = ["-u", self.account_file, "upload", video_path, "--title", title]
        if description:
            args += ["--desc", description]
        if tags:
            args += ["--tag", ",".join(tags)]
        if schedule_time:
            try:
                dt = datetime.fromisoformat(schedule_time)
                ts = int(dt.timestamp())
                args += ["--dtime", str(ts)]
            except ValueError:
                pass

        result = run_biliup_command(args)
        if result.returncode != 0:
            raise RuntimeError(f"B站上传失败: {result.stderr or result.stdout}")

        return {"success": True, "platform": "bilibili", "title": title}
