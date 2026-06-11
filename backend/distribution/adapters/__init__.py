from backend.distribution.adapters.douyin_adapter import DouyinAdapter
from backend.distribution.adapters.kuaishou_adapter import KuaishouAdapter
from backend.distribution.adapters.xiaohongshu_adapter import XiaohongshuAdapter
from backend.distribution.adapters.tencent_adapter import TencentAdapter
from backend.distribution.adapters.bilibili_adapter import BilibiliAdapter

ADAPTER_MAP = {
    "douyin": DouyinAdapter,
    "kuaishou": KuaishouAdapter,
    "xhs": XiaohongshuAdapter,
    "tencent": TencentAdapter,
    "wechat_channels": TencentAdapter,
    "bilibili": BilibiliAdapter,
}


def get_adapter(platform: str):
    cls = ADAPTER_MAP.get(platform)
    if cls is None:
        raise ValueError(f"Unsupported platform: {platform}")
    return cls
