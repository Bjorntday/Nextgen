from unittest.mock import MagicMock, patch

import requests

from backend.app_factory import create_app


def test_openai_compatible_model_test_normalizes_v1_endpoint():
    app = create_app({"TESTING": True})
    client = app.test_client()

    fake_resp = MagicMock()
    fake_resp.ok = True
    fake_resp.status_code = 200
    fake_resp.headers = {"content-type": "application/json"}
    fake_resp.json.return_value = {"data": [{"id": "gpt-image-2"}]}

    with patch("requests.get", return_value=fake_resp) as get:
        resp = client.post(
            "/api/settings/test-openai-compatible",
            json={
                "endpoint": "https://api.tu-zi.com/v1",
                "api_key": "sk-test",
                "model": "gpt-image-2",
            },
        )

    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True
    assert get.call_args.args[0] == "https://api.tu-zi.com/v1/models"


def test_image_model_test_accepts_image_endpoint_when_models_is_not_available():
    app = create_app({"TESTING": True})
    client = app.test_client()

    models_resp = MagicMock()
    models_resp.ok = False
    models_resp.status_code = 404
    models_resp.headers = {"content-type": "application/json"}
    models_resp.json.return_value = {"error": "not found"}

    image_probe_resp = MagicMock()
    image_probe_resp.status_code = 405

    with patch("requests.get", return_value=models_resp) as get, patch("requests.head", return_value=image_probe_resp) as head:
        resp = client.post(
            "/api/settings/test-openai-compatible",
            json={
                "endpoint": "https://api.tu-zi.com/v1",
                "api_key": "sk-test",
                "model": "gpt-image-2",
                "type": "image",
            },
        )

    body = resp.get_json()
    assert resp.status_code == 200
    assert body["ok"] is True
    assert body["message"] == "/v1/models 未开放，已按图片接口探测通过。"
    assert get.call_args.args[0] == "https://api.tu-zi.com/v1/models"
    assert head.call_args.args[0] == "https://api.tu-zi.com/v1/images/generations"


def test_openai_compatible_image_generate_calls_generations_endpoint():
    app = create_app({"TESTING": True})
    client = app.test_client()

    fake_resp = MagicMock()
    fake_resp.ok = True
    fake_resp.status_code = 200
    fake_resp.headers = {"content-type": "application/json"}
    fake_resp.json.return_value = {"data": [{"b64_json": "abc123"}]}

    with patch("requests.post", return_value=fake_resp) as post:
        resp = client.post(
            "/api/image/openai-compatible/generate",
            json={
                "endpoint": "https://api.tu-zi.com/v1",
                "api_key": "sk-test",
                "model": "gpt-image-2-vip",
                "prompt": "product photo",
                "mode": "txt2img",
                "count": 1,
                "ratio": "1:1",
            },
        )

    body = resp.get_json()
    assert resp.status_code == 200
    assert body["ok"] is True
    assert body["images"][0]["url"] == "data:image/png;base64,abc123"
    assert post.call_args.args[0] == "https://api.tu-zi.com/v1/images/generations"
    assert post.call_args.kwargs["json"] == {
        "model": "gpt-image-2-vip",
        "prompt": "product photo",
        "quality": "auto",
        "size": "1200x900",
    }
    assert body["model"] == "gpt-image-2-vip"


def test_openai_compatible_image_generate_normalizes_full_image_endpoint():
    app = create_app({"TESTING": True})
    client = app.test_client()

    fake_resp = MagicMock()
    fake_resp.ok = True
    fake_resp.status_code = 200
    fake_resp.headers = {"content-type": "application/json"}
    fake_resp.json.return_value = {"data": [{"b64_json": "abc123"}]}

    with patch("requests.post", return_value=fake_resp) as post:
        resp = client.post(
            "/api/image/openai-compatible/generate",
            json={
                "endpoint": "https://api.tu-zi.com/v1/images/edits",
                "api_key": "sk-test",
                "model": "gpt-image-2-vip",
                "prompt": "product photo",
                "mode": "txt2img",
                "count": 1,
            },
        )

    assert resp.status_code == 200
    assert post.call_args.args[0] == "https://api.tu-zi.com/v1/images/generations"
    assert post.call_args.kwargs["json"]["model"] == "gpt-image-2-vip"


def test_openai_compatible_image_generate_returns_provider_error():
    app = create_app({"TESTING": True})
    client = app.test_client()

    fake_resp = MagicMock()
    fake_resp.ok = False
    fake_resp.status_code = 401
    fake_resp.headers = {"content-type": "application/json"}
    fake_resp.json.return_value = {"error": "invalid key"}

    with patch("requests.post", return_value=fake_resp):
        resp = client.post(
            "/api/image/openai-compatible/generate",
            json={
                "endpoint": "https://api.tu-zi.com/v1",
                "api_key": "bad-key",
                "model": "gpt-image-2-vip",
                "prompt": "product photo",
                "mode": "txt2img",
            },
        )

    body = resp.get_json()
    assert resp.status_code == 401
    assert body["ok"] is False
    assert body["error_code"] == "IMAGE_GENERATION_FAILED"
    assert "invalid key" in body["recovery_suggestion"]


def test_openai_compatible_image_generate_sends_multiple_edit_images():
    app = create_app({"TESTING": True})
    client = app.test_client()

    fake_resp = MagicMock()
    fake_resp.ok = True
    fake_resp.status_code = 200
    fake_resp.headers = {"content-type": "application/json"}
    fake_resp.json.return_value = {"data": [{"b64_json": "result"}]}

    png = "data:image/png;base64,aGVsbG8="
    jpg = "data:image/jpeg;base64,d29ybGQ="
    with patch("requests.post", return_value=fake_resp) as post:
        resp = client.post(
            "/api/image/openai-compatible/generate",
            json={
                "endpoint": "https://api.tu-zi.com/v1",
                "api_key": "sk-test",
                "model": "gpt-image-2",
                "prompt": "replace material from image two",
                "mode": "img2img",
                "images": [png, jpg],
            },
        )

    assert resp.status_code == 200
    assert post.call_args.args[0] == "https://api.tu-zi.com/v1/images/edits"
    assert post.call_args.kwargs["timeout"] == 480
    assert resp.get_json()["model"] == "gpt-image-2"
    assert post.call_args.kwargs["data"]["model"] == "gpt-image-2"
    assert post.call_args.kwargs["data"]["size"] == "2049*3816"
    files = post.call_args.kwargs["files"]
    assert [name for name, _file in files].count("image") == 2
    assert files[0][1][0] == "input-1.png"
    assert files[1][1][0] == "input-2.jpg"


def test_openai_compatible_image_generate_retries_without_env_proxy_on_proxy_error():
    app = create_app({"TESTING": True})
    client = app.test_client()

    fake_resp = MagicMock()
    fake_resp.ok = True
    fake_resp.status_code = 200
    fake_resp.headers = {"content-type": "application/json"}
    fake_resp.json.return_value = {"data": [{"b64_json": "abc123"}]}

    session = MagicMock()
    session.request.return_value = fake_resp

    with patch("requests.post", side_effect=requests.exceptions.ProxyError("bad proxy")) as post, \
         patch("requests.Session", return_value=session) as session_cls:
        resp = client.post(
            "/api/image/openai-compatible/generate",
            json={
                "endpoint": "https://api.tu-zi.com/v1",
                "api_key": "sk-test",
                "model": "gpt-image-2",
                "prompt": "product photo",
                "mode": "txt2img",
            },
        )

    assert resp.status_code == 200
    assert post.call_count == 1
    session_cls.assert_called_once()
    assert session.trust_env is False
    assert session.request.call_args.args[:2] == ("POST", "https://api.tu-zi.com/v1/images/generations")


def test_openai_compatible_image_generate_returns_friendly_timeout():
    app = create_app({"TESTING": True})
    client = app.test_client()

    with patch("requests.post", side_effect=requests.exceptions.ReadTimeout("read timed out")):
        resp = client.post(
            "/api/image/openai-compatible/generate",
            json={
                "endpoint": "https://api.tu-zi.com/v1",
                "api_key": "sk-test",
                "model": "gpt-image-2",
                "prompt": "product photo",
                "mode": "txt2img",
            },
        )

    body = resp.get_json()
    assert resp.status_code == 504
    assert body["error_code"] == "IMAGE_GENERATION_TIMEOUT"
    assert "300 秒" in body["error"]


def test_openai_compatible_image_generate_retries_without_env_proxy_on_proxy_connection_error():
    app = create_app({"TESTING": True})
    client = app.test_client()

    fake_resp = MagicMock()
    fake_resp.ok = True
    fake_resp.status_code = 200
    fake_resp.headers = {"content-type": "application/json"}
    fake_resp.json.return_value = {"data": [{"b64_json": "abc123"}]}

    session = MagicMock()
    session.request.return_value = fake_resp

    proxy_exc = requests.exceptions.ConnectionError("Unable to connect to proxy")
    with patch("requests.post", side_effect=proxy_exc), \
         patch("requests.Session", return_value=session):
        resp = client.post(
            "/api/image/openai-compatible/generate",
            json={
                "endpoint": "https://api.tu-zi.com/v1",
                "api_key": "sk-test",
                "model": "gpt-image-2",
                "prompt": "product photo",
                "mode": "txt2img",
            },
        )

    assert resp.status_code == 200
    assert session.trust_env is False
    assert session.request.call_args.args[:2] == ("POST", "https://api.tu-zi.com/v1/images/generations")
