def test_app_identifies_itself(client) -> None:
    response = client.get("/api/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "wynterlabs-cards-api"}
