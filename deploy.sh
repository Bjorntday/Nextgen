#!/bin/bash
# NextGen Studio — Linux 一键部署脚本
# 用法: chmod +x deploy.sh && sudo ./deploy.sh

set -e

PROJECT_DIR="/opt/nextgen"
REPO_URL="https://github.com/Bjorntday/Nextgen.git"
SERVICE_NAME="nextgen"

echo "=== NextGen Studio 部署脚本 ==="

# 1. 安装依赖
echo "[1/5] 安装系统依赖..."
if command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq python3 python3-pip python3-venv nginx git
elif command -v yum &>/dev/null; then
    yum install -y python3 python3-pip nginx git
fi

# 2. Clone 项目
echo "[2/5] 克隆项目..."
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
if [ -d "Shoplive-main/.git" ]; then
    cd Shoplive-main && git pull
else
    git clone "$REPO_URL" Shoplive-main
fi

# 3. 创建 shoplive 符号链接（解决 Python import 路径）
echo "[3/5] 创建符号链接..."
ln -sf "$PROJECT_DIR/Shoplive-main" "$PROJECT_DIR/shoplive"

# 4. 安装 Python 依赖
echo "[4/5] 安装 Python 依赖..."
cd "$PROJECT_DIR/Shoplive-main"
pip3 install -r requirements.txt

# 5. 安装 systemd 服务
echo "[5/5] 配置开机自启..."
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=NextGen Studio
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$PROJECT_DIR/shoplive
ExecStart=/usr/bin/python3 backend/run.py
Restart=always
RestartSec=5
Environment="PATH=/usr/bin:/usr/local/bin"

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

echo ""
echo "=== 部署完成 ==="
echo "服务状态: systemctl status ${SERVICE_NAME}"
echo "访问地址: http://$(hostname -I | awk '{print $1}'):8000"
echo "端口: 8000"
echo ""
echo "常用命令:"
echo "  查看状态: systemctl status ${SERVICE_NAME}"
echo "  重启服务: systemctl restart ${SERVICE_NAME}"
echo "  查看日志: journalctl -u ${SERVICE_NAME} -f"
echo "  停止服务: systemctl stop ${SERVICE_NAME}"