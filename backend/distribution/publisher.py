from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from backend.distribution.adapters import get_adapter
from backend.distribution.auth import account_file_path, get_account_config, check_auth
from backend.distribution.tasks import (
    create_task,
    delete_task,
    run_upload_task,
    update_task,
    list_tasks,
    get_task,
)


class Publisher:
    def __init__(self, max_workers: int = 4):
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="publish")

    async def publish(
        self,
        platform: str,
        account: str,
        video_path: str = "",
        title: str = "",
        description: str = "",
        tags: list[str] | None = None,
        schedule_time: str = "",
        thumbnail: str = "",
        headless: bool | None = None,
        image_paths: list[str] | None = None,
    ) -> str:
        af = account_file_path(platform, account)
        config = get_account_config(platform, account)
        use_headless = headless if headless is not None else config.get("headless", True)

        adapter_cls = get_adapter(platform)
        adapter = adapter_cls(af, headless=use_headless)

        payload = {
            "platform": platform,
            "account": account,
            "video_path": video_path,
            "title": title,
            "description": description,
            "tags": tags or [],
            "schedule_time": schedule_time,
            "thumbnail": thumbnail,
        }
        if image_paths:
            payload["image_paths"] = image_paths
        task_id = create_task(platform, account, title, payload)

        def _do_upload():
            import asyncio
            from backend.distribution.media_utils import resolve_to_local, cleanup_temp_files

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            temp_paths = []
            try:
                auth_result = loop.run_until_complete(adapter.check_auth())
                if not auth_result:
                    update_task(task_id, status="failed", progress="认证失败",
                                error="Cookie 已失效，请重新登录账号")
                    return {"success": False, "error": "cookie_invalid"}

                local_video = resolve_to_local(video_path, temp_paths)
                local_thumbnail = resolve_to_local(thumbnail, temp_paths) if thumbnail else ""
                local_images = [resolve_to_local(p, temp_paths) for p in image_paths] if image_paths else None

                if local_images and not local_video:
                    result = loop.run_until_complete(
                        adapter.upload_image(
                            image_paths=local_images,
                            title=title,
                            description=description,
                            tags=tags or [],
                            schedule_time=schedule_time,
                        )
                    )
                else:
                    result = loop.run_until_complete(
                        adapter.upload_video(
                            video_path=local_video or video_path,
                            title=title,
                            description=description,
                            tags=tags or [],
                            schedule_time=schedule_time,
                            thumbnail=local_thumbnail or thumbnail,
                        )
                    )
                return result
            finally:
                cleanup_temp_files(temp_paths)
                loop.close()

        self._executor.submit(run_upload_task, task_id, _do_upload)
        return task_id

    async def publish_batch(self, posts: list[dict]) -> list[str]:
        task_ids = []
        for post in posts:
            task_id = await self.publish(**post)
            task_ids.append(task_id)
        return task_ids

    def get_task(self, task_id: str) -> dict | None:
        return get_task(task_id)

    def list_tasks(self, platform: str | None = None, status: str | None = None) -> list[dict]:
        return list_tasks(platform, status)

    def delete_task(self, task_id: str) -> bool:
        return delete_task(task_id)

    async def check_account_auth(self, platform: str, account: str) -> dict:
        return await check_auth(platform, account)
