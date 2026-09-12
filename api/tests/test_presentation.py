import uuid

from test_admin_api import _authenticated_client

from app.models import Role


def member(app, name):
    return _authenticated_client(
        app, user_id=uuid.uuid4(), role=Role.MEMBER, email=f"{name}@example.com", display_name=name
    )


def test_private_overlay_lifecycle(app):
    with member(app, "First") as first, member(app, "Second") as second:
        assert first.get("/api/v1/presentation").status_code == 200
        assert first.get("/api/v1/presentation").json()["settings"]["muted"] is False
        payload = {"id": "pull-1", "kind": "confirm", "card": {"name": "Test card", "quantity": 2}}
        assert first.post("/api/v1/presentation/events", json=payload).status_code == 200
        first.post("/api/v1/presentation/events", json=payload)
        assert len(first.get("/api/v1/presentation").json()["cards"]) == 1
        assert second.get("/api/v1/presentation").json()["cards"] == []
        token = first.post("/api/v1/presentation/link").json()["token"]
        with __import__("fastapi").testclient.TestClient(app) as viewer:
            headers = {"Authorization": f"Bearer {token}"}
            assert (
                viewer.get("/api/v1/presentation/overlay", headers=headers).json()["cards"][0][
                    "name"
                ]
                == "Test card"
            )
            assert (
                viewer.post(
                    "/api/v1/presentation/events", headers=headers, json=payload
                ).status_code
                == 401
            )
            first.post("/api/v1/presentation/events", json={"id": "finish-1", "kind": "finish"})
            assert (
                first.post(
                    "/api/v1/presentation/events", json={**payload, "id": "pull-2"}
                ).status_code
                == 409
            )
            first.delete("/api/v1/presentation/link")
            assert viewer.get("/api/v1/presentation/overlay", headers=headers).status_code == 404


def test_corrections_bounds_and_new_pack(app):
    with member(app, "Editor") as owner:
        base = "/api/v1/presentation"
        assert owner.put(base + "/settings", json={"volume": 9}).status_code == 422
        assert (
            owner.post(
                base + "/events",
                json={
                    "id": "bad",
                    "kind": "confirm",
                    "card": {"name": "X", "image": "javascript:alert(1)"},
                },
            ).status_code
            == 422
        )
        for i in range(2):
            owner.post(
                base + "/events",
                json={"id": f"dup-{i}", "kind": "confirm", "card": {"name": "Same"}},
            )
        owner.post(base + "/events", json={"id": "remove", "kind": "remove", "target": "dup-0"})
        assert [c["id"] for c in owner.get(base).json()["cards"]] == ["dup-1"]
        owner.post(base + "/events", json={"id": "end", "kind": "finish"})
        owner.post(base + "/events", json={"id": "new", "kind": "new"})
        state = owner.get(base).json()
        assert state["cards"] == [] and not state["finished"]


def test_link_rotation_new_pack_and_expiry(app):
    import asyncio
    from datetime import UTC, datetime, timedelta

    from fastapi.testclient import TestClient
    from sqlalchemy import update

    from app.models import Presentation

    with member(app, "Rotation") as owner, TestClient(app) as viewer:
        base = "/api/v1/presentation"
        one = owner.post(base + "/link").json()["token"]
        two = owner.post(base + "/link").json()["token"]

        def read(token):
            return viewer.get(base + "/overlay", headers={"Authorization": "Bearer " + token})

        assert read(one).status_code == 404
        assert read(two).headers["cache-control"] == "no-store"
        owner.post(base + "/events", json={"id": "new-pack", "kind": "new"})
        assert read(two).status_code == 404
        three = owner.post(base + "/link").json()["token"]

        async def expire():
            async with app.state.session_factory() as db:
                await db.execute(
                    update(Presentation).values(token_expires=datetime.now(UTC) - timedelta(days=1))
                )
                await db.commit()

        asyncio.run(expire())
        assert read(three).status_code == 404


def test_new_looks_and_custom_back_are_account_owned_and_reach_overlay(app):
    import base64

    back = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\ncard-back").decode()
    with member(app, "Looks") as owner, member(app, "OtherLooks") as other:
        for reveal in ["slide", "zoom", "pop", "tilt"]:
            result = owner.put(
                "/api/v1/presentation/settings",
                json={
                    "reveal": reveal,
                    "background": "grid",
                    "layout": "square",
                    "card_back": back,
                },
            )
            assert result.status_code == 200
            assert result.json()["settings"]["reveal"] == reveal
        assert other.get("/api/v1/presentation").json()["settings"]["card_back"] == ""
        token = owner.post("/api/v1/presentation/link").json()["token"]
        overlay = owner.get(
            "/api/v1/presentation/overlay", headers={"Authorization": f"Bearer {token}"}
        )
        assert overlay.json()["settings"]["card_back"] == back
        assert (
            owner.put(
                "/api/v1/presentation/settings",
                json={"card_back": "https://untrusted.example/back.svg"},
            ).status_code
            == 422
        )
        assert (
            owner.put(
                "/api/v1/presentation/settings",
                json={"card_back": "data:image/svg+xml;base64,PHN2Zz4="},
            ).status_code
            == 422
        )
        assert owner.put("/api/v1/presentation/settings", json={"card_back": ""}).status_code == 200


def test_found_is_preview_only_and_conditional_overlay_stays_authorized(app):
    with member(app, "Found") as owner:
        base = "/api/v1/presentation"
        found = owner.post(
            base + "/events",
            json={
                "id": "found-card",
                "kind": "found",
                "card": {"name": "Found card", "price": "$100"},
            },
        )
        assert found.status_code == 200
        doc = found.json()
        assert doc["cards"] == []
        assert doc["preview"]["name"] == "Found card"
        token = owner.post(base + "/link").json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        unchanged = owner.get(base + f"/overlay?after_revision={doc['revision']}", headers=headers)
        assert unchanged.status_code == 204
        assert unchanged.content == b""
        accepted = owner.post(
            base + "/events",
            json={
                "id": "accepted-card",
                "kind": "confirm",
                "card": {"name": "Found card", "price": "$100"},
            },
        )
        assert len(accepted.json()["cards"]) == 1
        assert accepted.json()["preview"] is None
        assert (
            owner.get(
                base + f"/overlay?after_revision={doc['revision']}", headers=headers
            ).status_code
            == 200
        )
        owner.delete(base + "/link")
        assert (
            owner.get(
                base + f"/overlay?after_revision={doc['revision']}", headers=headers
            ).status_code
            == 404
        )


def test_reward_settings_are_validated_and_saved(app):
    with member(app, "Rewards") as owner:
        from app.routers.presentation import Preferences

        prefs = Preferences().model_dump()
        assert [t["threshold"] for t in prefs["reward_tiers"]] == [5, 10, 20, 50, 100]
        prefs["reward_tiers"][4]["label"] = "Best pull!"
        assert owner.put("/api/v1/presentation/settings", json=prefs).status_code == 200
        assert (
            owner.get("/api/v1/presentation").json()["settings"]["reward_tiers"][4]["label"]
            == "Best pull!"
        )
        prefs["reward_tiers"][4]["threshold"] = 5
        assert owner.put("/api/v1/presentation/settings", json=prefs).status_code == 422
