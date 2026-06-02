#!/bin/bash
# ═══════════════════════════════════════════════════
# 九天云盒 Pro — OTA 自动更新代理
# 
# 部署位置: /opt/nextgen/ota-agent.sh
# 定时:     crontab -e 添加 */30 * * * * /opt/nextgen/ota-agent.sh
# 
# 逻辑:
#   1. 拉取最新镜像
#   2. 对比 hash，有变化才更新
#   3. 更新前备份当前镜像 tag
#   4. 新容器启动后做健康检查
#   5. 失败自动回滚到上一个版本
# ═══════════════════════════════════════════════════

set -euo pipefail

REGISTRY="registry.chinamobile.com/nextgen/nextgen"
CONTAINER="nextgen"
COMPOSE_DIR="/opt/nextgen"
LOG_FILE="/opt/nextgen/ota.log"
STABLE_TAG_FILE="/opt/nextgen/.stable_tag"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

# 获取当前运行的镜像 hash
current_hash() {
    docker inspect --format='{{.Image}}' "$CONTAINER" 2>/dev/null || echo "none"
}

# 获取当前稳定 tag
stable_tag() {
    if [ -f "$STABLE_TAG_FILE" ]; then cat "$STABLE_TAG_FILE"; else echo "stable"; fi
}

HASH_BEFORE=$(current_hash)
log "检查更新... (当前: $HASH_BEFORE)"

# 拉取最新镜像
docker pull "${REGISTRY}:latest" 2>&1 | tee -a "$LOG_FILE"

HASH_AFTER=$(docker inspect --format='{{.Id}}' "${REGISTRY}:latest" 2>/dev/null || echo "none")

if [ "$HASH_BEFORE" = "$HASH_AFTER" ]; then
    log "已是最新版本，跳过更新"
    exit 0
fi

log "发现新版本，开始更新..."

# 备份当前 tag
CURRENT_TAG=$(docker inspect --format='{{index .Config.Labels "com.nextgen.version"}}' "$CONTAINER" 2>/dev/null || echo "unknown")
docker tag "${REGISTRY}:latest" "${REGISTRY}:${CURRENT_TAG}" 2>/dev/null || true

# 更新 stable 指针
echo "latest" > "$STABLE_TAG_FILE"

# 重启容器
cd "$COMPOSE_DIR"
docker-compose down
docker-compose up -d

# 等待启动
sleep 8

# 健康检查
if curl -sf --max-time 5 http://localhost:8000/pages/index.html > /dev/null; then
    NEW_VER=$(docker inspect --format='{{index .Config.Labels "com.nextgen.version"}}' "$CONTAINER" 2>/dev/null || echo "?")
    log "✅ 更新成功 → $NEW_VER"
else
    log "❌ 新版本启动失败，回滚..."
    
    # 回滚到上一个 stable 镜像
    PREV_TAG=$(docker images "${REGISTRY}" --format '{{.Tag}}' | grep -v latest | head -1)
    if [ -n "$PREV_TAG" ]; then
        docker tag "${REGISTRY}:${PREV_TAG}" "${REGISTRY}:latest"
        docker-compose down
        docker-compose up -d
        log "⚠️  已回滚到 ${PREV_TAG}"
    else
        log "❌ 无可回滚版本！请手动修复"
    fi
fi
