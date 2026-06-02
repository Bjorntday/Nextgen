import os
import requests
from typing import Optional, Dict, Any, List

MINIMAX_API_HOST = os.getenv("MINIMAX_API_HOST", "https://api.minimaxi.com")
MINIMAX_API_KEY = os.getenv("MINIMAX_API_KEY", "")
MINIMAX_MODEL = os.getenv("MINIMAX_MODEL", "MiniMax-M2.7")


def get_minimax_client():
    """Get MiniMax API configuration."""
    api_key = os.getenv("MINIMAX_API_KEY", "")
    if not api_key:
        raise ValueError("MINIMAX_API_KEY environment variable is not set")
    return {
        "api_key": api_key,
        "base_url": os.getenv("MINIMAX_API_HOST", "https://api.minimaxi.com"),
        "model": os.getenv("MINIMAX_MODEL", "MiniMax-M2.7"),
    }


def call_minimax(
    messages: List[Dict[str, Any]],
    stream: bool = False,
    max_tokens: int = 2048,
    temperature: float = 0.7,
    timeout: int = 60,
    proxies: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Call MiniMax chat API with messages."""
    client = get_minimax_client()
    headers = {
        "Authorization": f"Bearer {client['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": client["model"],
        "messages": messages,
        "stream": stream,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    url = f"{client['base_url']}/anthropic/v1/messages"
    resp = requests.post(url, headers=headers, json=payload, proxies=proxies, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def understand_image(image_url: str, prompt: str, timeout: int = 60) -> str:
    """Understand an image using MiniMax model.

    Args:
        image_url: URL of the image (HTTP/HTTPS) or local file path
        prompt: Question or instruction about the image
        timeout: Request timeout in seconds

    Returns:
        Text description/answer from the model
    """
    if not image_url.startswith("http"):
        return understand_image_base64(image_url, prompt, timeout)

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": prompt
                },
                {
                    "type": "image",
                    "source": {
                        "type": "url",
                        "url": image_url
                    }
                }
            ]
        }
    ]
    result = call_minimax(messages, max_tokens=2048, timeout=timeout)
    content_blocks = result.get("content", [])
    text_response = ""
    for block in content_blocks:
        if block.get("type") == "text":
            text_response += block.get("text", "")
    return text_response.strip()


def understand_image_base64(image_path_or_data: str, prompt: str, timeout: int = 60) -> str:
    """Understand an image using base64 encoded image or local file path.

    Args:
        image_path_or_data: Either a local file path or base64 encoded image data
        prompt: Question or instruction about the image
        timeout: Request timeout in seconds

    Returns:
        Text description/answer from the model
    """
    # Check if it's a local file path
    if not image_path_or_data.startswith("data:"):
        # Treat as file path, read and convert to base64
        from pathlib import Path
        file_path = Path(image_path_or_data)
        if file_path.exists():
            import base64
            with open(file_path, "rb") as f:
                img_data = f.read()
            mime_type = f"image/{file_path.suffix.lstrip('.').lower()}"
            if mime_type == "image/jpg":
                mime_type = "image/jpeg"
            b64_data = base64.b64encode(img_data).decode("utf-8")
            image_path_or_data = f"data:{mime_type};base64,{b64_data}"
        else:
            raise FileNotFoundError(f"Image file not found: {image_path_or_data}")

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": prompt
                },
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "data": image_path_or_data
                    }
                }
            ]
        }
    ]
    result = call_minimax(messages, max_tokens=2048, timeout=timeout)
    content_blocks = result.get("content", [])
    text_response = ""
    for block in content_blocks:
        if block.get("type") == "text":
            text_response += block.get("text", "")
    return text_response.strip()