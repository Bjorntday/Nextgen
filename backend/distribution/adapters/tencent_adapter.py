from __future__ import annotations

from datetime import datetime

from patchright.async_api import async_playwright

from backend.distribution import vendor  # noqa: F401
from backend.distribution.vendor.uploader.tencent_uploader.main import (
    TencentVideo,
    cookie_auth,
    TENCENT_PUBLISH_STRATEGY_IMMEDIATE,
    TENCENT_PUBLISH_STRATEGY_SCHEDULED,
)


class TencentAdapter:
    def __init__(self, account_file: str, headless: bool = True):
        self.account_file = account_file
        self.headless = headless

    async def check_auth(self) -> bool:
        return await cookie_auth(self.account_file)

    async def upload_video(
        self,
        video_path: str,
        title: str,
        description: str = "",
        tags: list[str] | None = None,
        schedule_time: str = "",
        thumbnail: str = "",
    ) -> dict:
        publish_date = 0
        publish_strategy = TENCENT_PUBLISH_STRATEGY_IMMEDIATE
        if schedule_time:
            try:
                publish_date = datetime.fromisoformat(schedule_time)
                publish_strategy = TENCENT_PUBLISH_STRATEGY_SCHEDULED
            except ValueError:
                pass

        uploader = TencentVideo(
            title=title,
            file_path=video_path,
            tags=tags or [],
            publish_date=publish_date,
            account_file=self.account_file,
            desc=description or None,
            thumbnail_path=thumbnail or None,
            publish_strategy=publish_strategy,
            headless=self.headless,
        )
        async with async_playwright() as playwright:
            await uploader.upload(playwright)

        return {"success": True, "platform": "tencent", "title": title}
