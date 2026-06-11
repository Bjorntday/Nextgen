"""Distribution workspace API.

The distribution layer only models compliant publishing workflows:
official platform APIs when credentials and permissions exist, and assisted
publishing packages when a platform does not expose a stable seller-facing API.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from backend.distribution.auth import (
    account_file_path,
    add_account,
    check_auth,
    get_account_config,
    get_login_session_status,
    cancel_login_session,
    list_accounts,
    login_interactive,
    remove_account,
    save_account_config,
)
from backend.distribution.models import PLATFORM_META

PLATFORMS = {
    "xhs": {
        "id": "xhs",
        "name": "小红书",
        "kind": "assisted",
        "content_types": ["image_note", "video_note"],
        "title_max": 20,
        "body_max": 1000,
        "tags_max": 10,
        "status": "辅助发布",
        "note": "生成笔记发布包，由运营人员在官方后台复制、检查并确认发布。",
        "official_entry": "https://ark.xiaohongshu.com/",
    },
    "douyin": {
        "id": "douyin",
        "name": "抖音",
        "kind": "assisted",
        "content_types": ["video", "image"],
        "title_max": 55,
        "body_max": 0,
        "tags_max": 12,
        "status": "辅助发布",
        "note": "生成发布包，由运营人员在抖音创作者后台复制、检查并确认发布。",
        "official_entry": "https://creator.douyin.com/",
    },
    "kuaishou": {
        "id": "kuaishou",
        "name": "快手",
        "kind": "assisted",
        "content_types": ["video"],
        "title_max": 55,
        "body_max": 0,
        "tags_max": 12,
        "status": "辅助发布",
        "note": "未配置官方发布能力时，只生成发布包和人工确认清单。",
        "official_entry": "https://open.kuaishou.com/",
    },
    "tencent": {
        "id": "tencent",
        "name": "视频号",
        "kind": "assisted",
        "content_types": ["video"],
        "title_max": 55,
        "body_max": 0,
        "tags_max": 10,
        "status": "辅助发布",
        "note": "生成素材包、标题和发布检查清单，人工在官方入口完成。",
        "official_entry": "https://channels.weixin.qq.com/",
    },
    "bilibili": {
        "id": "bilibili",
        "name": "B站",
        "kind": "browser_automation",
        "content_types": ["video"],
        "title_max": 80,
        "body_max": 2000,
        "tags_max": 10,
        "status": "浏览器自动化发布",
        "note": "通过 biliup 工具自动上传，支持定时发布。首次使用需扫码登录。",
        "official_entry": "https://member.bilibili.com/",
    },
    "taobao": {
        "id": "taobao",
        "name": "淘宝",
        "kind": "commerce_api",
        "content_types": ["product_image", "product_video"],
        "title_max": 30,
        "body_max": 500,
        "tags_max": 0,
        "status": "商家接口",
        "note": "适合商品素材、详情页和商家后台同步，不等同于社媒笔记发布。",
        "official_entry": "https://open.taobao.com/",
    },
    "jd": {
        "id": "jd",
        "name": "京东",
        "kind": "commerce_api",
        "content_types": ["product_image", "product_video"],
        "title_max": 30,
        "body_max": 500,
        "tags_max": 0,
        "status": "商家接口",
        "note": "适合商品素材和商家后台同步。",
        "official_entry": "https://jos.jd.com/",
    },
}

JOBS = {}
CONNECTIONS = {
    "xhs": {
        "platform": "xhs",
        "configured": True,
        "mode": "assisted_package",
        "label": "辅助发布包",
        "message": "小红书采用发布包工作流：复制文案、下载素材、人工确认发布。",
        "updated_at": "",
    },
    "douyin": {
        "platform": "douyin",
        "configured": True,
        "mode": "assisted_package",
        "label": "辅助发布包",
        "message": "抖音采用发布包工作流：复制文案、下载素材、人工确认发布。",
        "updated_at": "",
    },
    "kuaishou": {
        "platform": "kuaishou",
        "configured": True,
        "mode": "browser_automation",
        "label": "浏览器自动化",
        "message": "通过浏览器自动化发布，需先添加快手账号并扫码登录。",
        "updated_at": "",
    },
    "tencent": {
        "platform": "tencent",
        "configured": True,
        "mode": "browser_automation",
        "label": "浏览器自动化",
        "message": "通过浏览器自动化发布，需先添加视频号账号并扫码登录。",
        "updated_at": "",
    },
    "bilibili": {
        "platform": "bilibili",
        "configured": True,
        "mode": "browser_automation",
        "label": "浏览器自动化",
        "message": "通过 biliup 工具发布，需先添加 B 站账号并扫码登录。",
        "updated_at": "",
    },
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value) -> str:
    return str(value or "").strip()


def _post_copy_text(platform_id: str, payload: dict) -> str:
    title = _clean_text(payload.get("title"))
    body = _clean_text(payload.get("body"))
    tags = payload.get("tags") or []
    tag_line = " ".join(f"#{_clean_text(tag)}" for tag in tags if _clean_text(tag))
    parts = [title]
    if body:
        parts.append(body)
    if tag_line:
        parts.append(tag_line)
    if platform_id == "xhs":
        parts.append("发布前检查：商品功效、价格、库存、违禁词和素材授权。")
    if platform_id == "douyin":
        parts.append("发布前检查：音乐/素材版权、营销话术、商品链接和内容发布权限。")
    return "\n\n".join(part for part in parts if part)


def _build_publish_package(platform_id: str, payload: dict) -> dict:
    platform = PLATFORMS.get(platform_id) or {"name": platform_id, "official_entry": ""}
    assets = payload.get("assets") or []
    checklist = [
        "确认素材来源可商用",
        "检查标题、话题和绝对化营销词",
        "确认商品价格、库存和优惠信息仍然有效",
        "发布前在官方后台预览一次",
    ]
    if platform_id == "xhs":
        checklist.insert(1, "小红书标题建议控制在 20 字内，正文保留真实体验感")
    if platform_id == "douyin":
        checklist.insert(1, "抖音标题建议突出产品卖点，话题控制在 12 个以内")

    return {
        "platform": platform_id,
        "platform_name": platform.get("name", platform_id),
        "title": _clean_text(payload.get("title")),
        "body": _clean_text(payload.get("body")),
        "tags": payload.get("tags") or [],
        "assets": assets,
        "copy_text": _post_copy_text(platform_id, payload),
        "official_entry": platform.get("official_entry", ""),
        "mode": CONNECTIONS.get(platform_id, {}).get("mode", platform.get("kind", "")),
        "checklist": checklist,
        "created_at": _now_iso(),
    }


def _validate_platform_payload(platform_id: str, payload: dict) -> list[dict]:
    platform = PLATFORMS.get(platform_id)
    if not platform:
        return [{"level": "error", "message": f"未知平台：{platform_id}"}]

    title = _clean_text(payload.get("title"))
    body = _clean_text(payload.get("body"))
    tags = payload.get("tags") or []
    assets = payload.get("assets") or []
    issues = []

    if not assets:
        issues.append({"level": "error", "message": "至少选择一个素材。"})
    if not title:
        issues.append({"level": "error", "message": f"{platform['name']} 标题不能为空。"})
    if title and len(title) > platform["title_max"]:
        issues.append({"level": "error", "message": f"标题超过 {platform['title_max']} 字。"})
    if platform["body_max"] and len(body) > platform["body_max"]:
        issues.append({"level": "error", "message": f"正文超过 {platform['body_max']} 字。"})
    if platform["tags_max"] and len(tags) > platform["tags_max"]:
        issues.append({"level": "warning", "message": f"话题超过 {platform['tags_max']} 个，建议精简。"})
    if platform["kind"] == "assisted":
        issues.append({"level": "info", "message": "该平台将生成辅助发布包，需要人工在官方后台确认。"})
    if platform["kind"] == "commerce_api":
        issues.append({"level": "info", "message": "该平台按商家素材同步处理，不做社媒账号模拟发布。"})

    risky_terms = ["最强", "全网第一", "绝对", "永久", "100%"]
    joined = f"{title}\n{body}"
    for term in risky_terms:
        if term in joined:
            issues.append({"level": "warning", "message": f"包含高风险绝对化表达：{term}"})

    return issues


def _get_platform_account(platform_id: str) -> str:
    accounts = list_accounts()
    for acc in accounts:
        if acc["platform"] == platform_id and acc.get("valid"):
            return acc["account"]
    return "default"


def _job_not_found(json_error):
    if json_error:
        return json_error(
            "发布任务不存在。",
            404,
            recovery_suggestion="Check the job_id or list jobs with GET /api/distribution/jobs.",
            error_code="JOB_NOT_FOUND",
        )
    return {"ok": False, "error": "job_not_found"}, 404


def register_distribution_routes(app, json_error=None, publisher=None):
    @app.get("/api/distribution/platforms")
    def distribution_platforms():
        return {"ok": True, "platforms": list(PLATFORMS.values())}

    @app.get("/api/distribution/connections")
    def distribution_connections():
        safe = {}
        for key, value in CONNECTIONS.items():
            item = dict(value)
            item.pop("client_secret", None)
            safe[key] = item
        return {"ok": True, "connections": safe}

    @app.post("/api/distribution/validate")
    def distribution_validate():
        from flask import request

        body = request.get_json(silent=True) or {}
        posts = body.get("posts") or []
        results = []
        for post in posts:
            platform_id = _clean_text(post.get("platform"))
            results.append({
                "platform": platform_id,
                "issues": _validate_platform_payload(platform_id, post),
            })
        ok = all(not any(issue["level"] == "error" for issue in row["issues"]) for row in results)
        return {"ok": ok, "results": results}

    @app.get("/api/distribution/jobs")
    def distribution_list_jobs():
        return {"ok": True, "jobs": list(JOBS.values())}

    @app.post("/api/distribution/jobs")
    def distribution_create_job():
        from flask import request

        body = request.get_json(silent=True) or {}
        posts = body.get("posts") or []
        validation = []
        for post in posts:
            platform_id = _clean_text(post.get("platform"))
            validation.append({
                "platform": platform_id,
                "issues": _validate_platform_payload(platform_id, post),
            })
        has_error = any(any(issue["level"] == "error" for issue in row["issues"]) for row in validation)
        if has_error:
            return {"ok": False, "validation": validation, "message": "校验未通过，不能加入队列。"}, 400

        job_id = f"dist_{uuid4().hex[:12]}"
        packages = [_build_publish_package(_clean_text(post.get("platform")), post) for post in posts]
        job = {
            "id": job_id,
            "status": "queued",
            "created_at": _now_iso(),
            "scheduled_at": body.get("scheduled_at") or "",
            "posts": posts,
            "packages": packages,
            "validation": validation,
            "publish_mode": "official_or_assisted",
        }
        JOBS[job_id] = job
        return {"ok": True, "job": job}

    @app.get("/api/distribution/jobs/<job_id>")
    def distribution_get_job(job_id):
        job = JOBS.get(job_id)
        if not job:
            return _job_not_found(json_error)
        return {"ok": True, "job": job}

    @app.delete("/api/distribution/jobs/<job_id>")
    def distribution_delete_job(job_id):
        if job_id not in JOBS:
            return _job_not_found(json_error)
        JOBS.pop(job_id, None)
        return {"ok": True, "deleted": job_id}

    @app.post("/api/distribution/jobs/<job_id>/publish")
    def distribution_publish_job(job_id):
        job = JOBS.get(job_id)
        if not job:
            return _job_not_found(json_error)

        import asyncio

        results = []
        task_ids = []
        packages = job.get("packages") or []
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            for i, post in enumerate(job.get("posts", [])):
                platform_id = _clean_text(post.get("platform"))
                platform = PLATFORMS.get(platform_id) or {}
                package = packages[i] if i < len(packages) else _build_publish_package(platform_id, post)

                publish_task_id = None
                publish_message = ""
                if publisher:
                    assets = post.get("assets") or []
                    video_asset = next((a for a in assets if a.get("type") == "video"), None)
                    image_assets = [a for a in assets if a.get("type") == "image"]
                    if video_asset and video_asset.get("url"):
                        thumbnail_asset = next((a for a in assets if a.get("type") == "image"), None)
                        try:
                            publish_task_id = loop.run_until_complete(
                                publisher.publish(
                                    platform=platform_id,
                                    account=_get_platform_account(platform_id),
                                    video_path=video_asset.get("url", ""),
                                    title=_clean_text(post.get("title")),
                                    description=_clean_text(post.get("body", "")),
                                    tags=post.get("tags") or [],
                                    thumbnail=thumbnail_asset.get("url", "") if thumbnail_asset else "",
                                )
                            )
                            if publish_task_id:
                                task_ids.append(publish_task_id)
                                publish_message = f"；已加入上传队列 (task: {publish_task_id})"
                        except Exception as pub_err:
                            publish_message = f"；触发上传失败: {pub_err}"
                    elif image_assets and image_assets[0].get("url"):
                        try:
                            publish_task_id = loop.run_until_complete(
                                publisher.publish(
                                    platform=platform_id,
                                    account=_get_platform_account(platform_id),
                                    title=_clean_text(post.get("title")),
                                    description=_clean_text(post.get("body", "")),
                                    tags=post.get("tags") or [],
                                    image_paths=[a.get("url", "") for a in image_assets if a.get("url")],
                                )
                            )
                            if publish_task_id:
                                task_ids.append(publish_task_id)
                                publish_message = f"；已加入上传队列 (task: {publish_task_id})"
                        except Exception as pub_err:
                            publish_message = f"；触发上传失败: {pub_err}"

                message = "已生成发布包" if publish_task_id else "已生成辅助发布包"
                message += publish_message or "，请在官方后台人工确认。"

                results.append({
                    "platform": platform_id,
                    "status": "assisted_package_ready",
                    "message": message,
                    "official_entry": platform.get("official_entry", ""),
                    "package": package,
                    "publish_task_id": publish_task_id,
                })
        finally:
            loop.close()

        job["status"] = "published"
        job["results"] = results
        job["task_ids"] = task_ids
        job["updated_at"] = _now_iso()
        return {"ok": True, "job": job}

    # -----------------------------------------------------------------------
    # Account Management
    # -----------------------------------------------------------------------

    @app.get("/api/distribution/accounts")
    def distribution_accounts_list():
        accounts = list_accounts()
        return {"ok": True, "accounts": accounts}

    @app.delete("/api/distribution/accounts/<platform>/<account>")
    def distribution_account_delete(platform, account):
        removed = remove_account(platform, account)
        return {"ok": removed, "message": "已删除" if removed else "账号不存在"}

    @app.put("/api/distribution/accounts/<platform>/<account>")
    def distribution_account_update(platform, account):
        from flask import request
        body = request.get_json(silent=True) or {}
        if "headless" in body:
            save_account_config(platform, account, {"headless": bool(body["headless"])})
        headless = get_account_config(platform, account).get("headless", True)
        return {"ok": True, "config": {"headless": headless}}

    @app.get("/api/distribution/export-cookies")
    def distribution_export_cookies():
        from flask import send_file
        import io, json, os, zipfile

        mpath = str(Path(account_file_path("_", "_")).parent / "accounts.json")
        if not os.path.exists(mpath):
            return {"ok": False, "message": "无账号数据可导出"}, 404

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(mpath, "accounts.json")
            manifest = json.loads(open(mpath, encoding="utf-8").read())
            for entry in manifest.get("accounts", []):
                cp = entry.get("cookie_path", "")
                if cp and os.path.exists(cp):
                    z.write(cp, os.path.basename(cp))
        buf.seek(0)
        return send_file(buf, mimetype="application/zip", as_attachment=True,
                         download_name="nextgen-cookies-导出.zip")

    # -----------------------------------------------------------------------
    # Authentication (Interactive Login)
    # -----------------------------------------------------------------------

    @app.post("/api/distribution/accounts/login")
    def distribution_login_start():
        from flask import request

        body = request.get_json(silent=True) or {}
        platform = _clean_text(body.get("platform"))
        account = _clean_text(body.get("account", "default"))
        headless = body.get("headless", False)

        if platform not in PLATFORMS:
            return {"ok": False, "message": f"不支持的平台: {platform}"}, 400

        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(login_interactive(platform, account, headless=headless))
            if result.get("success"):
                add_account(platform, account, valid=True, cookie_path=result.get("account_file", ""))
            return {
                "ok": result.get("success", False),
                "session_id": result.get("session_id", ""),
                "message": result.get("message", ""),
                "qrcode": result.get("qrcode"),
            }
        finally:
            loop.close()

    @app.get("/api/distribution/accounts/login/<session_id>")
    def distribution_login_status(session_id):
        status = get_login_session_status(session_id)
        if not status:
            return {"ok": False, "message": "登录会话不存在"}, 404
        return {"ok": True, "session": status}

    @app.post("/api/distribution/accounts/login/<session_id>/cancel")
    def distribution_login_cancel(session_id):
        cancelled = cancel_login_session(session_id)
        return {"ok": cancelled, "message": "已取消" if cancelled else "会话不存在"}

    @app.post("/api/distribution/auth/check")
    def distribution_auth_check():
        from flask import request

        body = request.get_json(silent=True) or {}
        platform = _clean_text(body.get("platform"))
        account = _clean_text(body.get("account", "default"))

        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(check_auth(platform, account))
            return {"ok": result.get("valid", False), **result}
        finally:
            loop.close()

    # -----------------------------------------------------------------------
    # Video Publish (browser automation)
    # -----------------------------------------------------------------------

    @app.post("/api/distribution/publish")
    def distribution_publish():
        from flask import request

        if not publisher:
            return {"ok": False, "message": "发布功能未初始化"}, 500

        body = request.get_json(silent=True) or {}
        platform = _clean_text(body.get("platform"))
        account = _clean_text(body.get("account", "default"))
        video_path = body.get("video_path", "")
        image_paths = body.get("image_paths")
        title = _clean_text(body.get("title"))
        description = _clean_text(body.get("description", ""))
        tags = body.get("tags") or []
        schedule_time = _clean_text(body.get("schedule_time", ""))
        thumbnail = body.get("thumbnail", "")
        headless = body.get("headless")

        if not platform or not title:
            return {"ok": False, "message": "platform, title 为必填项"}, 400
        if not video_path and not image_paths:
            return {"ok": False, "message": "需要提供 video_path 或 image_paths"}, 400

        if platform not in PLATFORMS:
            return {"ok": False, "message": f"不支持的平台: {platform}"}, 400

        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            task_id = loop.run_until_complete(
                publisher.publish(
                    platform=platform,
                    account=account,
                    video_path=video_path,
                    title=title,
                    description=description,
                    tags=tags,
                    schedule_time=schedule_time,
                    thumbnail=thumbnail,
                    headless=headless,
                    image_paths=image_paths,
                )
            )
            return {"ok": True, "task_id": task_id, "message": "发布任务已创建"}
        finally:
            loop.close()

    @app.post("/api/distribution/publish/batch")
    def distribution_publish_batch():
        from flask import request

        if not publisher:
            return {"ok": False, "message": "发布功能未初始化"}, 500

        body = request.get_json(silent=True) or {}
        posts = body.get("posts") or []

        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            task_ids = loop.run_until_complete(publisher.publish_batch(posts))
            return {"ok": True, "task_ids": task_ids, "count": len(task_ids)}
        finally:
            loop.close()

    # -----------------------------------------------------------------------
    # Task Status
    # -----------------------------------------------------------------------

    @app.get("/api/distribution/tasks")
    def distribution_tasks_list():
        from flask import request

        platform = request.args.get("platform")
        status = request.args.get("status")
        tasks = (publisher or _dummy_publisher()).list_tasks(platform=platform, status=status)
        return {"ok": True, "tasks": tasks}

    @app.get("/api/distribution/tasks/<task_id>")
    def distribution_task_detail(task_id):
        task = (publisher or _dummy_publisher()).get_task(task_id)
        if not task:
            return {"ok": False, "message": "任务不存在"}, 404
        return {"ok": True, "task": task}

    @app.delete("/api/distribution/tasks/<task_id>")
    def distribution_task_delete(task_id):
        deleted = (publisher or _dummy_publisher()).delete_task(task_id)
        if not deleted:
            return {"ok": False, "message": "任务不存在"}, 404
        return {"ok": True, "deleted": task_id}

    @app.get("/api/distribution/screenshots/<filename>")
    def distribution_screenshot(filename):
        import os, re
        from flask import send_file

        if not re.match(r"^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg)$", filename):
            return {"ok": False, "message": "无效的文件名"}, 400

        ss_dir = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "distribution", "vendor", "logs", "screenshots",
        )
        file_path = os.path.normpath(os.path.join(ss_dir, filename))
        if not file_path.startswith(os.path.normpath(ss_dir)):
            return {"ok": False, "message": "无效的文件路径"}, 400
        if not os.path.isfile(file_path):
            return {"ok": False, "message": "截图不存在"}, 404

        mime = "image/png" if filename.endswith(".png") else "image/jpeg"
        return send_file(file_path, mimetype=mime)


def _dummy_publisher():
    """Fallback when publisher is not injected: return empty results."""
    from backend.distribution.tasks import list_tasks, get_task as _get, delete_task as _del
    class _Dummy:
        list_tasks = staticmethod(list_tasks)
        get_task = staticmethod(_get)
        delete_task = staticmethod(_del)
    return _Dummy()
