# NextGen

NextGen is an AI video generation and editing workspace for ecommerce content production. It covers the workflow from product understanding and prompt generation to video creation, post-editing, and export.

## Features

- Product understanding from images, ecommerce links, and text prompts.
- AI prompt generation for scripts, storyboards, and model-ready video prompts.
- Product image generation through Image Lab.
- Text-to-video, image-to-video, and product-driven video workflows.
- Conversational Agent workspace for creation and natural-language editing.
- Viral video recreation from short-video share links.
- Online video editing with speed, color, subtitles, overlays, BGM, and timeline rendering.
- Backend tool manifests, audit logs, OpenAPI, and MCP-compatible endpoints.

## Modules

| Module | Purpose |
| --- | --- |
| Landing | Product input, reference image upload, fast Agent handoff |
| Agent | Conversational creation, product insight, video generation, natural-language editing |
| Image Lab | AI product image generation and handoff |
| Studio | Timeline editing, rendering, export |
| Backend API | Workflow orchestration, model adapters, video editing, audit, health checks |

## Tech Stack

- Backend: Python, Flask, Pydantic
- Frontend: HTML, CSS, Vanilla JavaScript, ES Modules
- Video processing: FFmpeg / FFprobe
- Page fetching: requests, Playwright
- AI: LLM prompt enhancement, video generation, image generation, ASR subtitles

## Quick Start

```bash
pip install -r requirements.txt
playwright install chromium
python backend/run.py
```

Open `http://127.0.0.1:8000`.

## Docker

```bash
docker compose up --build
```

The app listens on `http://127.0.0.1:8000`.
