from backend.app_factory import create_app


def test_distribution_missing_job_returns_structured_404():
    app = create_app({"TESTING": True})
    client = app.test_client()

    resp = client.get("/api/distribution/jobs/not_found")
    data = resp.get_json()

    assert resp.status_code == 404
    assert data["ok"] is False
    assert data["error_code"] == "JOB_NOT_FOUND"
