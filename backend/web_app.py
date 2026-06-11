#!/usr/bin/env python3
import hashlib
import os
import subprocess
import tempfile
import uuid

from flask import Flask, request, send_from_directory

from backend.briefing import (
    ALLOWED_VIDEO_DURATIONS,
    DEFAULT_VIDEO_DURATION,
    build_input_diff,
    build_shoplive_script,
    build_shoplive_script_prompt,
    build_shoplive_agent_enhance_template,
    build_shoplive_video_prompt_template,
    normalize_duration_seconds,
    normalize_shoplive_brief,
    normalize_selling_points,
    selfcheck_script,
    validate_shoplive_brief,
)
from backend.infra import (
    WORKSPACE_ROOT,
    PROJECT_DIR,
    build_proxies,
    get_access_token,
    parse_common_payload,
)
from backend.common.helpers import (
    json_error,
    fetch_image_as_base64,
    normalize_reference_urls,
    parse_data_url,
    parse_generic_data_url,
    escape_drawtext_text,
    download_video_to_file,
    normalize_reference_images_base64,
    extract_banana_urls,
    extract_imagen_images,
    extract_chat_content,
    extract_vertex_text,
    try_parse_json_object,
    parse_category_judge_text,
    judge_generated_image_category,
    call_vertex_chat as call_litellm_chat,
    call_vertex_chat_stream as call_litellm_chat_stream,
    extract_gs_paths,
    extract_inline_videos,
    sign_gcs_url,
    run_google_image_generate,
    infer_target_race,
    build_shoplive_image_rule_capsule,
    build_shoplive_image_prompt,
    build_shoplive_image_prompt_compact,
    build_shoplive_image_prompt_safe_product_only,
    build_image_prompt_via_llm,
    split_prompt_for_16s,
    split_prompt_for_12s,
    concat_videos_ffmpeg,
    download_gcs_blob_to_file,
    normalize_timeline_video_segments,
)
from backend.api.shoplive_api import register_shoplive_routes
from backend.api.agent_api import register_agent_routes
from backend.api.veo_api import register_veo_routes
from backend.api.media_api import register_media_routes
from backend.api.video_edit_api import register_video_edit_routes
from backend.api.hot_video_api import register_hot_video_routes
from backend.api.tabcode_api import register_tabcode_routes
from backend.api.ltxv_api import register_ltxv_routes
from backend.api.comfyui_ltxv_api import register_comfyui_ltxv_routes
from backend.api.jimeng_api import register_jimeng_routes
from backend.api.distribution_api import register_distribution_routes
from backend.distribution.publisher import Publisher
from backend.tool_registry import build_tool_manifest, get_tools_by_skill, get_tools_by_tags
from backend.skills import get_skill_by_id, list_skills_summary
from backend.mcp_adapter import (
    build_mcp_tools_list,
    build_mcp_tools_by_skill,
    handle_mcp_request,
)
from backend.audit import audit_log, setup_audit_middleware, get_trace_context
from backend.minimax_client import understand_image, understand_image_base64
from backend.infra import get_token_cache_stats

FRONTEND_ROOT = (PROJECT_DIR / "frontend").resolve()
FRONTEND_PAGES_DIR = (FRONTEND_ROOT / "pages").resolve()
app = Flask(__name__, static_folder=str(FRONTEND_ROOT), static_url_path="")
VIDEO_EDIT_EXPORT_DIR = (PROJECT_DIR / "video_edits").resolve()
VIDEO_EDIT_EXPORT_DIR.mkdir(parents=True, exist_ok=True)

# Setup audit middleware for automatic request tracing
setup_audit_middleware(app)


SHOPLIVE_VIDEO_SYSTEM_PROMPT = """
你是一位专为 Veo 视频模型服务的电商视频提示词总导演。根据用户输入（商品信息、卖点、场景、目标人群、时长、画幅、商品图）输出一条可直接用于视频生成的提示词，语言精炼、视觉具体、节奏可执行。

━━ 硬性约束 ━━
① 只聚焦1-2个核心卖点；单段时长4/6/8秒；16/24秒目标时长按8秒片段链式延展。
② 必须从下方框架库选”1主框架 + 1辅助框架”，不堆叠，不全选。
③ 有商品图时严格锁定颜色、材质、轮廓、关键细节，禁止漂移品类。
④ 禁止夸大、绝对化、虚构认证；禁止他牌标识、水印、畸形手、错误结构。
⑤ 只输出最终提示词正文，不加解释、列表、Markdown标题。
⑥ 末尾必须附：高光边缘干净，反光可控，材质纹理清晰，结构边缘锐利，不出现畸形手或错误结构，不出现他牌标识或水印。

━━ 框架库（选1主 + 1辅） ━━

【4.1 商品展示】适合：新品首发、高颜值单品、珠宝配饰、数码外观
视觉风格：影棚极简，商品是绝对主角，背景无干扰。
镜头序列：极近微距特写商品局部纹理/材质（0-2s）→ 45°轨道慢速环绕展示整体造型（2-5s）→ 正面英雄镜头锁定最强卖点细节（5-8s）。
光线：三点布光（主光塑形+补光控阴影+背光勾轮廓），色温随品牌色系。
相机：Dolly in / orbital tracking，超慢速，无抖动，浅景深背景虚化。
声音：极简氛围音或无声，最后1s加一声低沉的品牌收口音效。

【4.2 生活场景】适合：服装、家居、食品、日化、母婴
视觉风格：真实生活质感，商品在使用中被自然呈现，画面有温度。
镜头序列：场景建立镜头（环境+人+光线，0.5-1.5s）→ 商品自然入画或使用动作（1.5-4s，过肩/跟拍）→ 使用结果或情绪反应特写（4-6.5s，微距）→ 轻松收尾（最后0.5-1s）。
光线：窗边自然光或暖色室内漫射光，皮肤和材质质感真实，不过曝。
相机：轻微手持律动（不刻意稳定），模拟真实生活节奏，偶尔跟焦失误感。
声音：环境音（咖啡声/风声/厨房声）+ 轻快pop BGM，自然混合。

【4.3 痛点对比】适合：清洁/整理/护肤/健身/工具等功能解决型商品
视觉风格：强烈视觉对比驱动转化，AB两组光调刻意区分（痛点偏冷暗/解决偏暖明）。
镜头序列：Shot A 痛点场景（真实夸张，冷色调，0-2s）→ Shot B 商品登场+核心功能特写（暖色，2-4s，zoom in）→ Shot C 解决效果或性能数据可视化（4-6.5s，中景→特写）→ Shot D 满意反应+CTA收口（6.5-8s）。
相机：AB用跳切，BC平滑推进，CD稳定静帧或轻慢动作。
声音：A段环境音偏压抑，B段音乐骤起，C段节奏加强，D段放轻收口。

【4.4 功能演示】适合：科技产品、厨电、护肤仪器、工具类、运动装备
视觉风格：专业客观，流程可视化，细节真实，技术感强。
镜头序列：产品全貌开场（俯拍/平拍，0-1s）→ 使用步骤逐一展示（每步1-2s，俯拍与侧拍交替）→ 核心功能效果微距特写（近景，细节锐利）→ 使用结果/数据/状态呈现（最后1-2s，中景）。
光线：功能操作区域重点补光（环形灯或softbox），背景虚化，色温中性4500-5500K。
相机：稳定器+三脚架交替，无手持抖动，镜头理性克制。
声音：轻柔功能性BGM，每个操作步骤配轻点击/嗒声SFX，节奏跟随步骤。

【4.5 达人种草】适合：美妆彩妆、潮流服饰、零食饮品、个护香氛
视觉风格：社媒质感，高能量，真实测评感，画面活泼有感染力。
镜头序列：达人手持商品出场（POV/手部特写，0-0.5s）→ 拆封/初体验第一反应（0.5-2s，脸部+手部交替）→ 核心卖点微距特写（2-4.5s，膏体/材质/颜色）→ 上身/使用效果展示（4.5-7s，中景到特写对比）→ 夸张满意收口（最后0.5-1s）。
光线：环形灯或窗边漫射光，美颜感真实不假，肤色饱满。
相机：手持POV + 固定特写交替，快节奏跳切，高能量。
声音：强节奏pop/电子BGM，配合开箱声/涂抹声SFX，节奏感强。

【4.6 品牌叙事】适合：高端品牌、轻奢配饰、香水、情感营销、节日礼品
视觉风格：电影感优先，情绪驱动，商品是故事的一部分而非主角。
镜头序列：光影/质感情绪建立（环境空镜，0-2s，慢速）→ 人与商品的情感交互瞬间（2-5s，侧逆光，浅景深）→ 商品价值隐性呈现（5-7s，局部特写，含蓄）→ 品牌感收尾（最后1s，极简构图或fade）。
光线：单侧硬光或逆光剪影，或暖调烛光/夕阳，强调戏剧感与情绪层次。
相机：超慢速平移/推进，或完全静止长镜头，绝不急切。
声音：BGM有情绪弧线（弦乐/钢琴/环境音乐），不用流行节奏，留白克制。

━━ 框架选择速查 ━━
新品/高颜值/珠宝数码 → 4.1主 + 4.6辅
服装/家居/食品/日化 → 4.2主 + 4.5辅
功能工具/清洁/健身 → 4.4主 + 4.3辅
痛点明确/对比强 → 4.3主 + 4.4辅
美妆/潮流/个护 → 4.5主 + 4.2辅
高端/情感/品牌 → 4.6主 + 4.1辅

━━ 输出前自检 ━━
□ 主框架+辅助框架已选定，镜头序列可执行？
□ 只聚焦1-2个核心卖点？
□ 时长与画幅已体现，节奏合理？
□ 声音、转场、CTA都有？
□ 合规后缀已附？
""".strip()


# Shoplive brief/prompt helpers moved to `backend.briefing`.
register_shoplive_routes(
    app,
    json_error=json_error,
    normalize_shoplive_brief=normalize_shoplive_brief,
    build_input_diff=build_input_diff,
    validate_shoplive_brief=validate_shoplive_brief,
    build_shoplive_script=build_shoplive_script,
    build_shoplive_script_prompt=build_shoplive_script_prompt,
    selfcheck_script=selfcheck_script,
    build_shoplive_video_prompt_template=build_shoplive_video_prompt_template,
    build_shoplive_agent_enhance_template=build_shoplive_agent_enhance_template,
    call_litellm_chat=call_litellm_chat,
    extract_chat_content=extract_chat_content,
    shoplive_video_system_prompt=SHOPLIVE_VIDEO_SYSTEM_PROMPT,
    default_video_duration=DEFAULT_VIDEO_DURATION,
)
register_agent_routes(
    app,
    json_error=json_error,
    parse_common_payload=parse_common_payload,
    get_access_token=get_access_token,
    build_proxies=build_proxies,
    normalize_reference_images_base64=normalize_reference_images_base64,
    normalize_reference_urls=normalize_reference_urls,
    fetch_image_as_base64=fetch_image_as_base64,
    extract_vertex_text=extract_vertex_text,
    try_parse_json_object=try_parse_json_object,
    call_litellm_chat=call_litellm_chat,
    call_litellm_chat_stream=call_litellm_chat_stream,
    extract_chat_content=extract_chat_content,
)
register_veo_routes(
    app,
    json_error=json_error,
    parse_common_payload=parse_common_payload,
    get_access_token=get_access_token,
    build_proxies=build_proxies,
    normalize_reference_urls=normalize_reference_urls,
    normalize_reference_images_base64=normalize_reference_images_base64,
    parse_data_url=parse_data_url,
    fetch_image_as_base64=fetch_image_as_base64,
    normalize_duration_seconds=normalize_duration_seconds,
    extract_gs_paths=extract_gs_paths,
    extract_inline_videos=extract_inline_videos,
    sign_gcs_url=sign_gcs_url,
    split_prompt_for_16s=split_prompt_for_16s,
    split_prompt_for_12s=split_prompt_for_12s,
    concat_videos_ffmpeg=concat_videos_ffmpeg,
    download_gcs_blob_to_file=download_gcs_blob_to_file,
    call_litellm_chat=call_litellm_chat,
    video_export_dir=VIDEO_EDIT_EXPORT_DIR,
)
register_media_routes(
    app,
    json_error=json_error,
    parse_common_payload=parse_common_payload,
    get_access_token=get_access_token,
    build_proxies=build_proxies,
    extract_banana_urls=extract_banana_urls,
    run_google_image_generate=run_google_image_generate,
    build_shoplive_image_prompt_compact=build_shoplive_image_prompt_compact,
    build_shoplive_image_prompt_safe_product_only=build_shoplive_image_prompt_safe_product_only,
    build_image_prompt_via_llm=build_image_prompt_via_llm,
    judge_generated_image_category=judge_generated_image_category,
)
register_video_edit_routes(
    app,
    json_error=json_error,
    build_proxies=build_proxies,
    parse_generic_data_url=parse_generic_data_url,
    escape_drawtext_text=escape_drawtext_text,
    download_video_to_file=download_video_to_file,
    normalize_timeline_video_segments=normalize_timeline_video_segments,
    concat_videos_ffmpeg=concat_videos_ffmpeg,
    video_edit_export_dir=VIDEO_EDIT_EXPORT_DIR,
)
register_hot_video_routes(
    app,
    json_error=json_error,
    parse_common_payload=parse_common_payload,
    get_access_token=get_access_token,
    build_proxies=build_proxies,
    download_video_to_file=download_video_to_file,
    call_litellm_chat=call_litellm_chat,
    extract_chat_content=extract_chat_content,
    try_parse_json_object=try_parse_json_object,
)
register_tabcode_routes(app)
register_jimeng_routes(
    app,
    json_error=json_error,
    build_proxies=build_proxies,
)
register_ltxv_routes(
    app,
    json_error=json_error,
    build_proxies=build_proxies,
    fetch_image_as_base64=fetch_image_as_base64,
    video_export_dir=VIDEO_EDIT_EXPORT_DIR,
)
register_comfyui_ltxv_routes(
    app,
    json_error=json_error,
    video_export_dir=VIDEO_EDIT_EXPORT_DIR,
)
_publisher = Publisher()
register_distribution_routes(app, json_error=json_error, publisher=_publisher)

# ---------------------------------------------------------------------------
# Tool Manifest API (Article: "LLM 友好的接口设计")
# Enables Agent tool discovery, skill-based filtering, and tag-based recall.
# ---------------------------------------------------------------------------

@app.route("/api/tools/manifest")
def api_tools_manifest():
    """Return the full tool manifest for Agent consumption.

    This endpoint implements the article's "智能召回" concept:
    - Full manifest for initial discovery
    - Skill-based filtering via ?skill=video_generation
    - Tag-based filtering via ?tags=video,generation

    Usage by Agent:
    1. GET /api/tools/manifest → discover all tools
    2. GET /api/tools/manifest?skill=product_analysis → tools for product analysis
    3. GET /api/tools/manifest?tags=video,veo → tools related to Veo video
    """
    from flask import jsonify as _jsonify
    skill = request.args.get("skill", "").strip()
    tags = request.args.get("tags", "").strip()
    if skill:
        tools = get_tools_by_skill(skill)
        return _jsonify({"ok": True, "filter": {"skill": skill}, "tools": tools})
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        tools = get_tools_by_tags(tag_list)
        return _jsonify({"ok": True, "filter": {"tags": tag_list}, "tools": tools})
    return _jsonify(build_tool_manifest())


# ---------------------------------------------------------------------------
# MCP Protocol Endpoints
# ---------------------------------------------------------------------------

@app.route("/api/mcp/tools")
def api_mcp_tools():
    """MCP-compatible tool listing endpoint.

    Returns all tools in MCP Tool Definition format with inputSchema.
    Supports ?skill= filter for progressive tool disclosure.
    """
    from flask import jsonify as _jsonify
    skill = request.args.get("skill", "").strip()
    if skill:
        tools = build_mcp_tools_by_skill(skill)
    else:
        tools = build_mcp_tools_list()
    return _jsonify({"tools": tools})


@app.post("/api/mcp/rpc")
def api_mcp_rpc():
    """MCP JSON-RPC 2.0 endpoint.

    Handles: initialize, tools/list, tools/call.
    This enables any MCP-compatible Agent to interact with Shoplive tools.
    """
    from flask import jsonify as _jsonify
    rpc_body = request.get_json(silent=True) or {}
    result = handle_mcp_request(rpc_body)
    return _jsonify(result)


# ---------------------------------------------------------------------------
# Audit & Observability Endpoints
# ---------------------------------------------------------------------------

@app.route("/api/audit/stats")
def api_audit_stats():
    """Return aggregate audit statistics.

    Shows: total calls, success/error counts, error rate, per-tool metrics,
    avg duration, and token cache performance.
    """
    from flask import jsonify as _jsonify
    stats = audit_log.get_stats()
    stats["token_cache"] = get_token_cache_stats()
    return _jsonify({"ok": True, "stats": stats})


@app.route("/api/audit/recent")
def api_audit_recent():
    """Return recent audit records (last 50 by default).

    Supports ?limit=N for custom count, ?trace_id=xxx for specific trace.
    """
    from flask import jsonify as _jsonify
    trace_id = request.args.get("trace_id", "").strip()
    if trace_id:
        records = audit_log.get_trace(trace_id)
        return _jsonify({"ok": True, "trace_id": trace_id, "records": records})
    limit = int(request.args.get("limit", 50))
    records = audit_log.get_recent(limit=limit)
    return _jsonify({"ok": True, "count": len(records), "records": records})


@app.route("/api/audit/trace")
def api_audit_trace():
    """Return the call chain for the current request's trace."""
    from flask import jsonify as _jsonify
    ctx = get_trace_context()
    return _jsonify({"ok": True, "trace": ctx})


# ---------------------------------------------------------------------------
# Health Check (simple liveness + readiness probe)
# ---------------------------------------------------------------------------

@app.route("/api/health")
def api_health():
    """System health check and service status summary.

    Returns component status, audit metrics, token cache performance,
    and tool/skill counts. Suitable for monitoring and debug dashboards.
    """
    import sys
    from flask import jsonify as _jsonify
    from backend.tool_registry import TOOL_REGISTRY

    from backend.async_executor import product_insight_cache
    from backend.scraper.fetchers import get_playwright_pool_stats

    stats = audit_log.get_stats()
    token_stats = get_token_cache_stats()
    skill_summaries = list_skills_summary()
    veo_status_metrics = app.config.get("veo_status_metrics", {}) or {}
    pw_stats = get_playwright_pool_stats()
    cache_stats = product_insight_cache.get_stats()

    return _jsonify({
        "ok": True,
        "service": "shoplive",
        "version": "1.0.0",
        "python_version": sys.version.split()[0],
        "components": {
            "audit": {
                "status": "ok",
                "total_calls": stats.get("total_calls", 0),
                "success_count": stats.get("success_count", 0),
                "error_count": stats.get("error_count", 0),
                "error_rate": stats.get("error_rate", 0),
                "avg_duration_ms": stats.get("avg_duration_ms", 0),
            },
            "token_cache": {
                "status": "ok",
                "hits": token_stats.get("hits", 0),
                "misses": token_stats.get("misses", 0),
                "refreshes": token_stats.get("refreshes", 0),
                "hit_rate": round(
                    token_stats.get("hits", 0) /
                    max(token_stats.get("hits", 0) + token_stats.get("misses", 0), 1),
                    4,
                ),
            },
            "tools": {
                "status": "ok",
                "count": len(TOOL_REGISTRY),
            },
            "veo_status": {
                "status": "ok",
                "total_calls": int(veo_status_metrics.get("total_calls", 0)),
                "retried_calls": int(veo_status_metrics.get("retried_calls", 0)),
                "retry_attempts_total": int(veo_status_metrics.get("retry_attempts_total", 0)),
                "transient_events": int(veo_status_metrics.get("transient_events", 0)),
                "retry_exhausted": int(veo_status_metrics.get("retry_exhausted", 0)),
            },
            "skills": {
                "status": "ok",
                "count": len(skill_summaries),
                "ids": [s["id"] for s in skill_summaries],
            },
            "playwright_pool": {
                "status": "ok",
                "launches": pw_stats.get("launches", 0),
                "reuses": pw_stats.get("reuses", 0),
                "crashes": pw_stats.get("crashes", 0),
            },
            "product_insight_cache": {
                "status": "ok",
                "hits": cache_stats.get("hits", 0),
                "misses": cache_stats.get("misses", 0),
                "active": cache_stats.get("active", 0),
                "evictions": cache_stats.get("evictions", 0),
                "ttl_seconds": cache_stats.get("ttl_seconds", 0),
            },
        },
    })


def _normalize_openai_compatible_base(endpoint: str) -> str:
    """Return provider host/base without the OpenAI resource path."""
    endpoint = str(endpoint or "").strip().rstrip("/")
    lower = endpoint.lower()
    for suffix in (
        "/v1/images/generations",
        "/v1/images/edits",
        "/images/generations",
        "/images/edits",
        "/v1/models",
        "/models",
    ):
        if lower.endswith(suffix):
            return endpoint[:-len(suffix)]
    if lower.endswith("/v1"):
        return endpoint[:-3]
    return endpoint


def _is_gpt_image_2_family(model: str) -> bool:
    return str(model or "").strip().lower().startswith("gpt-image-2")


def _resolve_image_model_for_mode(model: str, mode: str) -> str:
    """Use the configured model for text-to-image; strip -vip for edit APIs."""
    model = str(model or "").strip()
    if mode != "txt2img" and model.lower().endswith("-vip"):
        return model[:-4]
    return model


def _resolve_image_size(model: str, mode: str, ratio: str, explicit_size: str = "") -> str:
    explicit_size = str(explicit_size or "").strip()
    if explicit_size:
        return explicit_size
    if _is_gpt_image_2_family(model):
        return "1200x900" if mode == "txt2img" else "2049*3816"
    return {
        "1:1": "1024x1024",
        "4:3": "1536x1024",   # ≈ 3:2 landscape, closest to 4:3
        "3:2": "1536x1024",
        "16:9": "1536x1024",  # closest landscape
        "3:4": "1024x1536",   # ≈ 2:3 portrait
        "2:3": "1024x1536",
        "9:16": "1024x1536",  # closest portrait
    }.get(ratio, "1024x1024")


def _request_retry_without_env_proxy(requests_module, request_func, method: str, url: str, **kwargs):
    """Retry once without env/system proxy if requests fails at the proxy layer."""
    try:
        return request_func(url, **kwargs)
    except (
        requests_module.exceptions.ProxyError,
        requests_module.exceptions.ConnectionError,
    ) as exc:
        if not isinstance(exc, requests_module.exceptions.ProxyError):
            detail = str(exc).lower()
            if "proxy" not in detail and "tunnel" not in detail:
                raise
        session = requests_module.Session()
        session.trust_env = False
        return session.request(method, url, **kwargs)


@app.post("/api/settings/test-openai-compatible")
def api_test_openai_compatible_model():
    """Test an OpenAI-compatible model endpoint without exposing the key to browser CORS."""
    from flask import jsonify as _jsonify
    import requests as _requests

    payload = request.get_json(silent=True) or {}
    endpoint = str(payload.get("endpoint") or payload.get("api_base") or "").strip()
    api_key = str(payload.get("api_key") or "").strip()
    api_type = str(payload.get("type") or payload.get("category") or "llm").strip().lower()
    if not endpoint:
        return json_error("endpoint 不能为空", 400, error_code="MISSING_ENDPOINT")
    if not api_key:
        return json_error("api_key 不能为空", 400, error_code="MISSING_API_KEY")
    if not endpoint.lower().startswith(("http://", "https://")):
        endpoint = "https://" + endpoint
    endpoint = endpoint.rstrip("/")
    base = _normalize_openai_compatible_base(endpoint)
    url = f"{base}/v1/models"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        resp = _request_retry_without_env_proxy(_requests, _requests.get, "GET", url, headers=headers, timeout=20)
        content_type = resp.headers.get("content-type", "")
        data = resp.json() if "json" in content_type.lower() else {"raw": resp.text[:500]}
        if not resp.ok:
            if api_type == "image" and resp.status_code == 404:
                probe_results = []
                for path in ("/v1/images/generations", "/v1/images/edits"):
                    probe_url = f"{base}{path}"
                    probe = _request_retry_without_env_proxy(_requests, _requests.head, "HEAD", probe_url, headers=headers, timeout=20)
                    probe_results.append({"endpoint": probe_url, "status_code": probe.status_code})
                    if probe.status_code in {200, 204, 400, 405, 415, 422}:
                        return _jsonify({
                            "ok": True,
                            "status_code": probe.status_code,
                            "endpoint": probe_url,
                            "model_count": None,
                            "message": "/v1/models 未开放，已按图片接口探测通过。",
                            "response": {"models": data, "probe": probe_results},
                        })
            return json_error(
                f"模型检测失败: HTTP {resp.status_code}",
                400,
                recovery_suggestion=str(data)[:300],
                error_code="MODEL_TEST_FAILED",
            )
        models = data.get("data") if isinstance(data, dict) else None
        return _jsonify({
            "ok": True,
            "status_code": resp.status_code,
            "endpoint": url,
            "model_count": len(models) if isinstance(models, list) else None,
            "response": data,
        })
    except Exception as exc:
        return json_error(
            f"模型检测失败: {exc}",
            500,
            recovery_suggestion="检查端点是否为 OpenAI 兼容地址，例如 https://api.example.com/v1。",
            error_code="MODEL_TEST_ERROR",
        )


# ---------------------------------------------------------------------------
# OpenAPI 3.0 Spec Auto-Generation (Article: "OpenAPI 自动生成")
# Generated from Pydantic request schemas — always in sync with code.
# ---------------------------------------------------------------------------

@app.post("/api/image/openai-compatible/generate")
def api_openai_compatible_image_generate():
    """Generate images through an OpenAI-compatible image endpoint."""
    from flask import jsonify as _jsonify
    import base64 as _base64
    import io as _io
    import requests as _requests

    payload = request.get_json(silent=True) or {}
    endpoint = str(payload.get("endpoint") or payload.get("api_base") or "").strip()
    api_key = str(payload.get("api_key") or "").strip()
    model = str(payload.get("model") or "").strip()
    prompt = str(payload.get("prompt") or "").strip()
    mode = str(payload.get("mode") or "txt2img").strip().lower()
    count = max(1, min(int(payload.get("count") or payload.get("n") or 1), 4))
    ratio = str(payload.get("ratio") or "1:1").strip()
    quality = str(payload.get("quality") or "auto").strip()

    if not endpoint:
        return json_error("endpoint 不能为空", 400, error_code="MISSING_ENDPOINT")
    if not api_key:
        return json_error("api_key 不能为空", 400, error_code="MISSING_API_KEY")
    if not model:
        return json_error("model 不能为空", 400, error_code="MISSING_MODEL")
    if not prompt:
        return json_error("prompt 不能为空", 400, error_code="MISSING_PROMPT")
    if not endpoint.lower().startswith(("http://", "https://")):
        endpoint = "https://" + endpoint

    endpoint = endpoint.rstrip("/")
    base = _normalize_openai_compatible_base(endpoint)
    resolved_model = _resolve_image_model_for_mode(model, mode)
    size = _resolve_image_size(resolved_model, mode, ratio, payload.get("size") or payload.get("image_size"))
    request_timeout = 300 if mode == "txt2img" else 480
    headers = {"Authorization": f"Bearer {api_key}"}

    def _read_response(resp):
        content_type = resp.headers.get("content-type", "")
        return resp.json() if "json" in content_type.lower() else {"raw": resp.text[:1000]}

    def _extract_images(data):
        images = []
        items = data.get("data") if isinstance(data, dict) else None
        if not isinstance(items, list):
            items = data.get("images") if isinstance(data, dict) else None
        if not isinstance(items, list):
            return images
        for item in items:
            if not isinstance(item, dict):
                continue
            if isinstance(item.get("url"), str):
                images.append({"url": item["url"]})
            elif isinstance(item.get("b64_json"), str):
                images.append({"url": f"data:image/png;base64,{item['b64_json']}"})
            elif isinstance(item.get("base64"), str):
                mime = item.get("mime_type") or item.get("mime") or "image/png"
                images.append({"url": f"data:{mime};base64,{item['base64']}"})
            elif isinstance(item.get("data_url"), str):
                images.append({"url": item["data_url"]})
        return images

    try:
        if mode == "txt2img":
            url = f"{base}/v1/images/generations"
            json_body = {"model": resolved_model, "prompt": prompt, "quality": quality, "size": size}
            if count > 1:
                json_body["n"] = count
            resp = _request_retry_without_env_proxy(
                _requests,
                _requests.post,
                "POST",
                url,
                headers={**headers, "Content-Type": "application/json"},
                json=json_body,
                timeout=request_timeout,
            )
        else:
            image_items = payload.get("images")
            if isinstance(image_items, list):
                image_values = [str(x or "").strip() for x in image_items if str(x or "").strip()]
            else:
                image_data = str(payload.get("image") or payload.get("ref_image") or "").strip()
                image_values = [image_data] if image_data else []
            if not image_values:
                return json_error("图生图/局部重绘需要上传图片", 400, error_code="MISSING_IMAGE")

            files = []
            for idx, image_data in enumerate(image_values, start=1):
                b64, mime = parse_generic_data_url(image_data, "image")
                if mime not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
                    return json_error(f"不支持的图片格式: {mime}", 400, error_code="INVALID_IMAGE")
                ext = "jpg" if mime in {"image/jpeg", "image/jpg"} else mime.split("/")[-1]
                files.append(("image", (f"input-{idx}.{ext}", _io.BytesIO(_base64.b64decode(b64)), mime)))

            mask_data = str(payload.get("mask") or "").strip()
            if mask_data:
                mask_b64, mask_mime = parse_generic_data_url(mask_data, "image")
                mask_ext = "jpg" if mask_mime in {"image/jpeg", "image/jpg"} else mask_mime.split("/")[-1]
                files.append(("mask", (f"mask.{mask_ext}", _io.BytesIO(_base64.b64decode(mask_b64)), mask_mime)))

            url = f"{base}/v1/images/edits"
            resp = _request_retry_without_env_proxy(
                _requests,
                _requests.post,
                "POST",
                url,
                headers=headers,
                data={"model": resolved_model, "prompt": prompt, "n": str(count), "size": size},
                files=files,
                timeout=request_timeout,
            )

        data = _read_response(resp)
        if not resp.ok:
            return json_error(
                f"图片生成失败 HTTP {resp.status_code}",
                resp.status_code if resp.status_code >= 400 else 502,
                recovery_suggestion=str(data)[:500],
                error_code="IMAGE_GENERATION_FAILED",
            )
        images = _extract_images(data)
        if not images:
            return json_error(
                "图片接口返回成功，但未找到图片结果",
                502,
                recovery_suggestion=str(data)[:500],
                error_code="IMAGE_RESULT_EMPTY",
            )
        return _jsonify({"ok": True, "endpoint": url, "model": resolved_model, "images": images, "response": data})
    except ValueError as exc:
        return json_error(str(exc), 400, error_code="INVALID_IMAGE")
    except _requests.exceptions.Timeout:
        return json_error(
            f"图片生成超时：模型在 {request_timeout} 秒内没有返回结果",
            504,
            recovery_suggestion="模型服务仍可能在排队或生成中。请稍后重试；如果连续超时，建议减少参考图数量、降低输出尺寸，或换一个更快的模型。",
            error_code="IMAGE_GENERATION_TIMEOUT",
        )
    except Exception as exc:
        return json_error(
            f"图片生成请求失败: {exc}",
            502,
            recovery_suggestion="检查端点、模型名、API Key 和网络连通性。",
            error_code="IMAGE_GENERATION_ERROR",
        )


_openapi_spec_cache: dict = {}  # cached once at first request

@app.route("/api/openapi.json")
def api_openapi_spec():
    """Auto-generated OpenAPI 3.0 specification from Pydantic schemas.

    Always in sync with the actual request models — no manual maintenance.
    Compatible with Swagger UI, Redoc, and MCP tool definition converters.

    Usage:
        GET /api/openapi.json → full spec
        Open in Swagger UI for interactive API exploration.
    """
    from flask import jsonify as _jsonify
    if _openapi_spec_cache:
        return _jsonify(_openapi_spec_cache)

    from backend.schemas import TOOL_SCHEMAS
    from backend.tool_registry import TOOL_REGISTRY

    # Build components/schemas from Pydantic models
    component_schemas: dict = {}
    schema_name_map: dict = {}  # tool_name -> schema class name
    for tool_name, model_cls in TOOL_SCHEMAS.items():
        raw_schema = model_cls.model_json_schema()
        cls_name = model_cls.__name__
        # Hoist nested $defs into component_schemas
        defs = raw_schema.pop("$defs", {})
        component_schemas.update(defs)
        component_schemas[cls_name] = raw_schema
        schema_name_map[tool_name] = cls_name

    # Reverse-map endpoint path to tool name
    endpoint_tool_map: dict = {}
    for tool in TOOL_REGISTRY:
        endpoint = tool.get("endpoint", "")
        if not endpoint:
            continue
        parts = endpoint.split(" ", 1)
        if len(parts) == 2:
            endpoint_tool_map[parts[1]] = tool["name"]

    # Build OpenAPI paths from tool registry
    paths: dict = {}
    for tool in TOOL_REGISTRY:
        endpoint = tool.get("endpoint", "")
        if not endpoint:
            continue
        parts = endpoint.split(" ", 1)
        if len(parts) != 2:
            continue
        method, path = parts[0].lower(), parts[1]
        tool_name = tool["name"]
        cls_name = schema_name_map.get(tool_name)

        operation: dict = {
            "summary": tool.get("display_name", tool_name),
            "description": tool.get("description", ""),
            "tags": tool.get("tags", []),
            "operationId": tool_name,
            "responses": {
                "200": {
                    "description": "Success",
                    "content": {
                        "application/json": {
                            "schema": {"type": "object", "properties": {
                                "ok": {"type": "boolean"},
                            }},
                        }
                    },
                },
                "400": {"description": "Validation error — check error_code and recovery_suggestion"},
                "500": {"description": "Internal server error"},
            },
        }

        if method == "post" and cls_name:
            operation["requestBody"] = {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": f"#/components/schemas/{cls_name}"},
                        "examples": {
                            ex.get("input", {}).get("product_url", tool_name): {
                                "value": ex.get("input", {}),
                            }
                            for ex in tool.get("examples", [])[:1]
                        } if tool.get("examples") else {},
                    }
                },
            }

        if path not in paths:
            paths[path] = {}
        paths[path][method] = operation

    # Add non-tool endpoints
    paths["/api/health"] = {
        "get": {
            "summary": "Health Check",
            "description": "Service liveness and readiness probe with component status.",
            "tags": ["observability"],
            "operationId": "health_check",
            "responses": {"200": {"description": "Service is healthy"}},
        }
    }
    paths["/api/audit/stats"] = {
        "get": {
            "summary": "Audit Statistics",
            "description": "Aggregate tool call metrics and token cache performance.",
            "tags": ["observability"],
            "operationId": "audit_stats",
            "responses": {"200": {"description": "Audit statistics"}},
        }
    }
    paths["/api/tools/manifest"] = {
        "get": {
            "summary": "Tool Manifest",
            "description": "Full tool registry for Agent discovery. Supports ?skill= and ?tags= filters.",
            "tags": ["discovery"],
            "operationId": "tools_manifest",
            "parameters": [
                {"name": "skill", "in": "query", "schema": {"type": "string"}, "description": "Filter by skill ID"},
                {"name": "tags", "in": "query", "schema": {"type": "string"}, "description": "Comma-separated tag filters"},
            ],
            "responses": {"200": {"description": "Tool manifest"}},
        }
    }
    paths["/api/skills"] = {
        "get": {
            "summary": "List Skills",
            "description": "Available skills for progressive tool discovery.",
            "tags": ["discovery"],
            "operationId": "list_skills",
            "responses": {"200": {"description": "Skill summaries"}},
        }
    }

    spec = {
        "openapi": "3.0.3",
        "info": {
            "title": "Shoplive Agent API",
            "description": (
                "AI-powered e-commerce video generation platform. "
                "Provides tools for product scraping, script generation, "
                "Veo video creation, image generation, and video editing. "
                "All tools follow the Agent Tools design principles: "
                "type-safe, LLM-friendly, self-healing with recovery suggestions."
            ),
            "version": "1.0.0",
            "contact": {"name": "Shoplive Team"},
        },
        "servers": [{"url": "/", "description": "Local server"}],
        "tags": [
            {"name": "product", "description": "Product data extraction and analysis"},
            {"name": "video", "description": "Video generation and editing"},
            {"name": "image", "description": "Product image generation"},
            {"name": "observability", "description": "Audit, health, and metrics"},
            {"name": "discovery", "description": "Tool and skill discovery"},
        ],
        "paths": paths,
        "components": {
            "schemas": component_schemas,
        },
    }

    _openapi_spec_cache.update(spec)
    return _jsonify(spec)


@app.route("/api/skills")
def api_skills_list():
    """List available Skills for Agent discovery (summaries only).

    Returns concise skill descriptions following the "渐进式披露" principle:
    summaries first, full execution guides loaded on demand via /api/skills/<id>.
    """
    from flask import jsonify as _jsonify
    return _jsonify({"ok": True, "skills": list_skills_summary()})


@app.route("/api/skills/<skill_id>")
def api_skill_detail(skill_id: str):
    """Load a specific Skill with its full execution guide.

    The execution_guide field acts as an "操作说明书" that guides
    the Agent step-by-step through a complex multi-tool workflow.
    """
    from flask import jsonify as _jsonify
    skill = get_skill_by_id(skill_id)
    if not skill:
        return json_error(
            f"Skill '{skill_id}' not found",
            404,
            recovery_suggestion="Use GET /api/skills to see available skills.",
            error_code="SKILL_NOT_FOUND",
        )
    return _jsonify({"ok": True, "skill": skill})


@app.route("/")
def index():
    return send_from_directory(str(FRONTEND_PAGES_DIR), "index.html")


@app.route("/<path:asset_path>")
def serve_frontend_asset(asset_path: str):
    # Keep API routing explicit via /api/* handlers; this route serves frontend files only.
    if asset_path.startswith("api/"):
        return json_error("Not Found", 404)
    return send_from_directory(str(FRONTEND_ROOT), asset_path)


@app.route("/video-edits/<path:filename>")
def serve_video_edit_export(filename: str):
    return send_from_directory(str(VIDEO_EDIT_EXPORT_DIR), filename)


@app.route("/api/minimax/image/understand")
def api_minimax_image_understand():
    """Understand an image using MiniMax model.

    Query params:
        image_url: URL of the image (HTTP/HTTPS) or local path
        prompt: Question about the image

    Returns:
        JSON with text description
    """
    from flask import jsonify as _jsonify

    image_url = request.args.get("image_url", "").strip()
    prompt = request.args.get("prompt", "请描述这张图片的内容").strip()

    if not image_url:
        return json_error("image_url 参数不能为空", 400, error_code="MISSING_IMAGE_URL")

    try:
        if not image_url.startswith("http"):
            result = understand_image_base64(image_url, prompt)
        else:
            result = understand_image(image_url, prompt)

        return _jsonify({"ok": True, "result": result})
    except ValueError as e:
        return json_error(str(e), 400, error_code="MISSING_API_KEY")
    except Exception as e:
        return json_error(f"MiniMax API 调用失败: {str(e)}", 500, error_code="MINIMAX_ERROR")


@app.before_request
def handle_options_preflight():
    if request.method == "OPTIONS":
        return ("", 204)


@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    # Prevent browsers from caching JS/CSS so code changes take effect immediately
    ct = resp.content_type or ""
    if "javascript" in ct or "css" in ct or request.path.endswith((".js", ".css")):
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return resp


def create_app(config=None):  # type: ignore[assignment]  # dict | None, Python 3.9 compat
    """Return the Flask application, optionally applying config overrides.

    Accepts a ``config`` dict whose keys are Flask config names, e.g.::

        create_app({"TESTING": True, "SECRET_KEY": "test-secret"})

    This enables proper test isolation: each test suite can call
    ``create_app({"TESTING": True})`` and get a correctly configured
    test client without modifying the global app state.

    All routes and middleware are already registered at import time (module
    level).  This function is the canonical public entry-point so that
    ``gunicorn``, ``pytest``, and ``run.py`` all use the same factory.
    """
    if config:
        app.config.update(config)
    return app


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    create_app().run(host="127.0.0.1", port=port, debug=True)
