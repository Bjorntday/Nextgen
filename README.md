# NextGen

> 面向电商营销的 AI 视频生成与编辑工作台。

![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![Flask](https://img.shields.io/badge/Backend-Flask-black)
![License](https://img.shields.io/badge/License-MIT-green)

## 功能

| 模块 | 说明 |
|------|------|
| **Landing** | AI 商品图生成、工作台式 Prompt 输入 |
| **Agent** | 商品洞察、提示词增强、多模型视频生成、自然语言编辑视频 |
| **Studio** | 时间线编辑、异步渲染 |
| **Image Lab** | AI 商品图生成管线 |
| **Hot Video** | 爆款视频一键复刻（抖音/小红书/快手链接） |

## 技术栈

- **Backend**: Flask + Pydantic + Google Vertex AI (Veo) + LiteLLM
- **Frontend**: Vanilla JS (ES Modules)
- **Video**: FFmpeg 编辑导出
- **Scraper**: Playwright + requests 多平台电商抓取

## 快速开始

### 1. 克隆

```bash
git clone https://github.com/Bjorntday/Nextgen.git
cd Nextgen
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
playwright install chromium
```

### 3. 配置环境

```bash
cp .env.template .env
# 编辑 .env 配置必要的 API Key
```

### 4. 启动

```bash
python backend/run.py
```

访问 `http://127.0.0.1:8000`

| 页面 | 地址 |
|------|------|
| Landing | `/` |
| Agent | `/pages/agent.html` |
| Studio | `/pages/studio.html` |
| Image Lab | `/pages/image-lab.html` |

## 项目结构

```
nextgen/
├── backend/
│   ├── run.py              # 启动入口
│   ├── web_app.py          # Flask 主应用
│   ├── briefing.py          # 脚本与提示词编排
│   ├── infra.py            # 鉴权、代理、公共参数
│   ├── schemas.py          # Pydantic 模型
│   ├── audit.py            # 全链路审计
│   ├── api/ # API 路由
│   │   ├── agent_api.py    # Agent 对话
│   │   ├── shoplive_api.py # 视频工作流
│   │   ├── veo_api.py      # Veo/Grok 视频生成
│   │   ├── media_api.py    # AI 生图
│   │   ├── video_edit_api.py # FFmpeg 视频编辑
│   │   ├── hot_video_api.py # 爆款视频复刻
│   │   └── ...
│   ├── scraper/           # 电商链接抓取
│   └── tests/             # 测试
├── frontend/
│   ├── pages/            # 多页面入口
│   ├── styles/            # CSS
│   ├── scripts/          # JS 模块
│   └── assets/            # 静态资源
├── docs/                 # 文档截图
├── requirements.txt
└── LICENSE
```

## API 路由

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agent/chat` | POST | LLM 对话 |
| `/api/agent/run` | POST | Agent 自然语言执行视频编辑 |
| `/api/shoplive/video/workflow` | POST | 脚本生成/提示词构建 |
| `/api/shoplive/image/generate` | POST | AI 商品图生成 |
| `/api/veo/start` | POST | Veo 视频生成 |
| `/api/veo/status` | POST | 查询 Veo 任务状态 |
| `/api/video/edit/export` | POST | FFmpeg 视频编辑导出 |
| `/api/video/asr` | POST | ASR 语音识别字幕 |
| `/api/hot-video/remake` | POST | 爆款视频复刻 |
| `/api/tools/manifest` | GET | LLM 工具清单 |
| `/api/health` | GET | 健康检查 |

## License

MIT