# NextGen — 九天云盒 Pro 容器镜像
FROM python:3.11-slim

LABEL com.nextgen.version="1.0.0"
LABEL com.nextgen.product="九天云盒 Pro"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 静态文件由 Flask 托管，数据卷单独挂载
RUN mkdir -p /data/images /data/outputs /data/video_edits

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:8000/pages/index.html || exit 1

EXPOSE 8000
CMD ["python", "backend/run.py"]
