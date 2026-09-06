from fastapi.testclient import TestClient


def test_healthz_is_open(client: TestClient) -> None:
    response = client.get("/api/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
