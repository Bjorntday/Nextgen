"""Distribution workspace API.

The distribution layer only models compliant publishing workflows:
official platform APIs when credentials and permissions exist, and assisted
publishing packages when a platform does not expose a stable seller-facing API.
"""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlencode
from uuid import uuid4


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
        "kind": "official_api",
        "content_types": ["video", "image"],
        "title_max": 55,
        "body_max": 0,
        "tags_max": 12,
        "status": "可接官方 API",
        "note": "需要抖音开放平台应用、OAuth 授权和内容发布权限。",
        "official_entry": "https://open.douyin.com/",
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
    "wechat_channels": {
        "id": "wechat_channels",
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
        "configured": False,
        "mode": "official_oauth",
        "label": "OAuth 未配置",
        "client_key": "",
        "redirect_uri": "",
        "message": "填写抖音开放平台应用信息后，可进入授权和官方 API 发布流程。",
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
        checklist.insert(1, "抖音自动发布前必须完成开放平台 OAuth 授权")

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
    if platform_id == "douyin" and not CONNECTIONS["douyin"]["configured"]:
        issues.append({"level": "warning", "message": "抖音未配置 OAuth，只能生成发布包，不能自动提交。"})
    elif platform["kind"] == "official_api":
        issues.append({"level": "info", "message": "将通过官方 API 发布，提交前仍需要平台权限校验。"})
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


def _job_not_found(json_error):
    if json_error:
        return json_error("job_not_found", "发布任务不存在。", status=404)
    return {"ok": False, "error": "job_not_found"}, 404


def register_distribution_routes(app, json_error=None):
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

    @app.post("/api/distribution/connections/douyin")
    def distribution_save_douyin_connection():
        from flask import request

        body = request.get_json(silent=True) or {}
        client_key = _clean_text(body.get("client_key"))
        redirect_uri = _clean_text(body.get("redirect_uri"))
        if not client_key or not redirect_uri:
            return {"ok": False, "message": "请填写抖音应用 Client Key 和回调地址。"}, 400
        CONNECTIONS["douyin"].update({
            "configured": True,
            "label": "OAuth 已配置",
            "client_key": client_key,
            "redirect_uri": redirect_uri,
            "message": "已配置抖音 OAuth 信息，下一步到官方开放平台完成授权。",
            "updated_at": _now_iso(),
        })
        return {"ok": True, "connection": {k: v for k, v in CONNECTIONS["douyin"].items() if k != "client_secret"}}

    @app.get("/api/distribution/oauth/douyin/start")
    def distribution_douyin_oauth_start():
        conn = CONNECTIONS["douyin"]
        if not conn.get("configured"):
            return {"ok": False, "message": "请先配置抖音应用信息。"}, 400
        query = urlencode({
            "client_key": conn.get("client_key", ""),
            "response_type": "code",
            "scope": "video.create,video.data",
            "redirect_uri": conn.get("redirect_uri", ""),
        })
        return {
            "ok": True,
            "authorize_url": f"https://open.douyin.com/platform/oauth/connect?{query}",
            "message": "请在抖音开放平台授权后，把 code 回传给服务端换取 access_token。",
        }

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

    @app.post("/api/distribution/packages")
    def distribution_create_packages():
        from flask import request

        body = request.get_json(silent=True) or {}
        posts = body.get("posts") or []
        packages = [_build_publish_package(_clean_text(post.get("platform")), post) for post in posts]
        return {"ok": True, "packages": packages}

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

    @app.post("/api/distribution/jobs/<job_id>/cancel")
    def distribution_cancel_job(job_id):
        job = JOBS.get(job_id)
        if not job:
            return _job_not_found(json_error)
        job["status"] = "cancelled"
        job["updated_at"] = _now_iso()
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

        results = []
        for post in job.get("posts", []):
            platform_id = _clean_text(post.get("platform"))
            platform = PLATFORMS.get(platform_id) or {}
            package = _build_publish_package(platform_id, post)
            if platform_id == "douyin":
                if CONNECTIONS["douyin"]["configured"]:
                    results.append({
                        "platform": platform_id,
                        "status": "ready_for_official_api",
                        "message": "已具备 OAuth 配置；需要 access_token 后调用抖音官方内容发布接口。",
                        "official_entry": platform.get("official_entry", ""),
                        "package": package,
                    })
                else:
                    results.append({
                        "platform": platform_id,
                        "status": "needs_oauth",
                        "message": "未配置抖音 OAuth，当前只生成辅助发布包。",
                        "official_entry": platform.get("official_entry", ""),
                        "package": package,
                    })
            else:
                results.append({
                    "platform": platform_id,
                    "status": "assisted_package_ready",
                    "message": "已生成辅助发布包，请在官方后台人工确认。",
                    "official_entry": platform.get("official_entry", ""),
                    "package": package,
                })
        job["status"] = "ready"
        job["results"] = results
        job["packages"] = [item["package"] for item in results if item.get("package")]
        job["updated_at"] = _now_iso()
        return {"ok": True, "job": job}
