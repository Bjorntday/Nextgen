# NextGen container image
FROM python:3.11-slim

LABEL com.nextgen.version="1.0.0"
LABEL com.nextgen.product="NextGen"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Flask serves static files; generated data can be mounted separately.
RUN mkdir -p /data/images /data/outputs /data/video_edits

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:8000/pages/index.html || exit 1

EXPOSE 8000
CMD ["python", "backend/run.py"]
