from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from uuid import uuid4

_tasks: dict[str, dict] = {}
_tasks_lock = threading.Lock()
_account_locks: dict[str, threading.Lock] = {}
_account_locks_lock = threading.Lock()

# Serialize all browser automation globally to avoid Chrome/Playwright instance conflicts
_global_publish_lock = threading.Lock()


def _account_lock_key(platform: str, account: str) -> str:
    return f"{platform}:{account}"


def _get_account_lock(platform: str, account: str) -> threading.Lock:
    key = _account_lock_key(platform, account)
    with _account_locks_lock:
        if key not in _account_locks:
            _account_locks[key] = threading.Lock()
        return _account_locks[key]


def create_task(platform: str, account: str, title: str, payload: dict) -> str:
    task_id = f"pub_{uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    task = {
        "id": task_id,
        "platform": platform,
        "account": account,
        "status": "queued",
        "progress": "等待发布",
        "title": title,
        "payload": payload,
        "result": {},
        "error": "",
        "created_at": now,
        "updated_at": now,
        "duration_ms": 0,
    }
    with _tasks_lock:
        _tasks[task_id] = task
    return task_id


def update_task(task_id: str, **kwargs):
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task:
            for k, v in kwargs.items():
                task[k] = v
            task["updated_at"] = datetime.now(timezone.utc).isoformat()


def get_task(task_id: str) -> dict | None:
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task:
            return dict(task)
        return None


def list_tasks(platform: str | None = None, status: str | None = None) -> list[dict]:
    with _tasks_lock:
        results = []
        for task in _tasks.values():
            if platform and task["platform"] != platform:
                continue
            if status and task["status"] != status:
                continue
            results.append(dict(task))
        results.sort(key=lambda t: t["created_at"], reverse=True)
        return results


def run_upload_task(task_id: str, upload_fn):
    task = get_task(task_id)
    if not task:
        return

    platform = task["platform"]
    account = task["account"]
    lock = _get_account_lock(platform, account)

    start_time = time.time()
    with _global_publish_lock:
        with lock:
            try:
                update_task(task_id, status="running", progress="正在上传")
                result = upload_fn()
                elapsed = int((time.time() - start_time) * 1000)
                update_task(task_id, status="success", progress="发布成功", result=result, duration_ms=elapsed)
            except Exception as exc:
                elapsed = int((time.time() - start_time) * 1000)
                update_task(task_id, status="failed", progress="发布失败", error=str(exc), duration_ms=elapsed)


def delete_task(task_id: str) -> bool:
    with _tasks_lock:
        if task_id in _tasks:
            del _tasks[task_id]
            return True
        return False
