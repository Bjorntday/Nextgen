from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PlatformAccount(BaseModel):
    platform: str = Field(description="Platform identifier")
    account: str = Field(description="Account name")
    headless: bool = Field(default=True, description="Whether to run browser in headless mode")


class PublishRequest(BaseModel):
    platform: Literal["douyin", "kuaishou", "xhs", "bilibili", "tencent"] = Field(description="Target platform")
    account: str = Field(description="Account name/login identifier")
    video_path: str = Field(default="", description="Absolute path to the video file")
    title: str = Field(description="Video title")
    description: str = Field(default="", description="Video description")
    tags: list[str] = Field(default_factory=list, description="Hashtags")
    schedule_time: str = Field(default="", description="ISO datetime for scheduled publish, empty means immediate")
    thumbnail: str = Field(default="", description="Absolute path to thumbnail image")
    image_paths: list[str] | None = Field(default=None, description="Absolute paths to image files for image-note publish")
    headless: bool | None = Field(default=None, description="Override default headless mode for this publish")


class BatchPublishPost(BaseModel):
    platform: Literal["douyin", "kuaishou", "xhs", "bilibili", "tencent"]
    account: str
    video_path: str = ""
    title: str
    description: str = ""
    tags: list[str] = []
    schedule_time: str = ""
    thumbnail: str = ""
    image_paths: list[str] | None = None
    headless: bool | None = None


class BatchPublishRequest(BaseModel):
    posts: list[BatchPublishPost]


class LoginRequest(BaseModel):
    platform: Literal["douyin", "kuaishou", "xhs", "bilibili", "tencent"]
    account: str = Field(default="default", description="Account name for cookie file")


class AuthCheckRequest(BaseModel):
    platform: Literal["douyin", "kuaishou", "xhs", "bilibili", "tencent"]
    account: str = Field(default="default")


class AccountConfigUpdate(BaseModel):
    headless: bool | None = Field(default=None, description="Headless mode for this account")


class AccountInfo(BaseModel):
    platform: str
    account: str
    valid: bool
    expires_at: str = ""
    last_used: str = ""
    headless: bool = True
    cookie_path: str = ""
    created_at: str = ""


class TaskStatus(BaseModel):
    id: str
    platform: str
    account: str
    status: Literal["queued", "running", "success", "failed", "cancelled"]
    progress: str = ""
    title: str = ""
    result: dict = {}
    error: str = ""
    created_at: str = ""
    updated_at: str = ""
    duration_ms: int = 0


PLATFORM_META = {
    "douyin": {
        "name": "抖音",
        "login_url": "https://creator.douyin.com/",
        "upload_url": "https://creator.douyin.com/creator-micro/content/upload",
        "cookie_pattern": "douyin_{account}.json",
        "content_types": ["video", "image_note"],
        "title_max": 30,
    },
    "kuaishou": {
        "name": "快手",
        "login_url": "https://passport.kuaishou.com/pc/account/login/",
        "upload_url": "https://cp.kuaishou.com/article/publish/video",
        "cookie_pattern": "kuaishou_{account}.json",
        "content_types": ["video", "image_note"],
        "title_max": 55,
    },
    "xhs": {
        "name": "小红书",
        "login_url": "https://creator.xiaohongshu.com/login",
        "upload_url": "https://creator.xiaohongshu.com/publish/publish",
        "cookie_pattern": "xiaohongshu_{account}.json",
        "content_types": ["video", "image_note"],
        "title_max": 20,
    },
    "bilibili": {
        "name": "B站",
        "login_url": "https://member.bilibili.com/",
        "upload_url": "",
        "cookie_pattern": "bilibili_{account}.json",
        "content_types": ["video"],
        "title_max": 80,
    },
    "tencent": {
        "name": "视频号",
        "login_url": "https://channels.weixin.qq.com/",
        "upload_url": "https://channels.weixin.qq.com/platform/post/create",
        "cookie_pattern": "tencent_{account}.json",
        "content_types": ["video"],
        "title_max": 55,
    },
}
