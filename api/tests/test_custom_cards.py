import uuid

from test_admin_api import _authenticated_client

from app.models import Role


def test_custom_card_collection_deck_and_private_export(app):
    with _authenticated_client(
        app,
        user_id=uuid.uuid4(),
        role=Role.MEMBER,
        email="custom@example.com",
        display_name="Collector",
    ) as owner:
        response = owner.post(
            "/api/v1/custom-cards",
            json={
                "name": "My missing card",
                "game": "mtg",
                "set_name": "My set",
                "collector_number": "42",
                "value_usd": "12.50",
                "quantity": 2,
                "image_url": "https://example.com/card.png",
            },
        )
        assert response.status_code == 201, response.text
        card = response.json()
        card_id = card["printing_id"]
        assert card["is_custom"] is True
        assert owner.get("/api/v1/collection").json()["items"][0]["quantity"] == 2
        assert owner.get(f"/api/v1/catalog/cards/{card_id}").status_code == 200
        deck = owner.post("/api/v1/decks", json={"name": "Custom deck", "format": "modern"})
        assert deck.status_code == 201, deck.text
        added = owner.put(
            f"/api/v1/decks/{deck.json()['id']}/cards",
            json={
                "printing_id": card_id,
                "section": "mainboard",
                "quantity": 1,
            },
        )
        assert added.status_code == 200, added.text
        exported = owner.get("/api/v1/custom-cards/export").json()
        assert exported["cards"][0]["value_usd"] == "12.50"
        assert exported["cards"][0]["image_url"] == "https://example.com/card.png"
        with _authenticated_client(
            app,
            user_id=uuid.uuid4(),
            role=Role.MEMBER,
            email="other@example.com",
            display_name="Other",
        ) as other:
            assert other.get("/api/v1/custom-cards/export").json()["cards"] == []
            assert other.get(f"/api/v1/catalog/cards/{card_id}").status_code == 404
            assert (
                other.get("/api/v1/catalog/cards", params={"q": "My missing"}).json()["total"] == 0
            )
            denied = other.post(
                "/api/v1/collection/items",
                json={
                    "printing_id": card_id,
                    "finish": "nonfoil",
                    "condition": "near_mint",
                    "quantity": 1,
                },
            )
            assert denied.status_code == 404
            imported = other.post("/api/v1/custom-cards/import", json=exported)
            assert imported.status_code == 201, imported.text
            assert other.get("/api/v1/collection").json()["items"][0]["quantity"] == 2


def test_custom_card_validation_and_atomic_import(app):
    with _authenticated_client(
        app,
        user_id=uuid.uuid4(),
        role=Role.MEMBER,
        email="validate@example.com",
        display_name="Collector",
    ) as client:
        for invalid in (
            {"name": " "},
            {"name": "X", "image_url": "javascript:alert(1)"},
            {"name": "X", "value_usd": "-1"},
            {"name": "X", "quantity": 0},
        ):
            assert (
                client.post("/api/v1/custom-cards", json={"game": "mtg", **invalid}).status_code
                == 422
            )
        assert (
            client.post(
                "/api/v1/custom-cards/import",
                json={
                    "schema_version": 1,
                    "cards": [
                        {"name": "Valid", "game": "mtg"},
                        {"name": "", "game": "mtg"},
                    ],
                },
            ).status_code
            == 422
        )
        assert client.get("/api/v1/custom-cards/export").json()["cards"] == []


def test_custom_cards_require_sign_in(client):
    assert client.post("/api/v1/custom-cards", json={"name": "X", "game": "mtg"}).status_code == 401


def test_other_collectibles_and_csv_isolation(app):
    with _authenticated_client(
        app,
        user_id=uuid.uuid4(),
        role=Role.MEMBER,
        email="category@example.com",
        display_name="Collector",
    ) as owner:
        card = owner.post(
            "/api/v1/custom-cards", json={"name": "Signed collectible", "game": "custom"}
        )
        assert card.status_code == 201, card.text
        deck = owner.post(
            "/api/v1/decks", json={"name": "Other cards", "game": "custom", "format": "unlimited"}
        )
        assert deck.status_code == 201, deck.text
        assert (
            owner.put(
                f"/api/v1/decks/{deck.json()['id']}/cards",
                json={
                    "printing_id": card.json()["printing_id"],
                    "section": "mainboard",
                    "quantity": 1,
                },
            ).status_code
            == 200
        )
        csv = owner.get("/api/v1/collection/export.csv").content
        own_preview = owner.post(
            "/api/v1/collection/imports/preview", content=csv, headers={"content-type": "text/csv"}
        )
        assert own_preview.status_code == 201, own_preview.text
        with _authenticated_client(
            app,
            user_id=uuid.uuid4(),
            role=Role.MEMBER,
            email="csvother@example.com",
            display_name="Other",
        ) as other:
            preview = other.post(
                "/api/v1/collection/imports/preview",
                content=csv,
                headers={"content-type": "text/csv"},
            )
            assert preview.status_code == 201, preview.text
            assert "printing_not_found" in preview.text


def test_owner_can_delete_account_with_custom_cards(app):
    import asyncio
    from sqlalchemy import func, select
    from app.models import CardPrinting

    member_id = uuid.uuid4()
    with _authenticated_client(
        app, user_id=member_id, role=Role.MEMBER, email="remove@example.com", display_name="Remove"
    ) as member:
        assert (
            member.post("/api/v1/custom-cards", json={"name": "Private", "game": "mtg"}).status_code
            == 201
        )
    with _authenticated_client(
        app, user_id=uuid.uuid4(), role=Role.OWNER, email="owner@example.com", display_name="Owner"
    ) as owner:
        response = owner.request(
            "DELETE", f"/api/v1/admin/users/{member_id}", json={"confirmation": "DELETE ACCOUNT"}
        )
        assert response.status_code == 204, response.text

    async def remaining():
        async with app.state.session_factory() as db:
            return await db.scalar(
                select(func.count())
                .select_from(CardPrinting)
                .where(CardPrinting.custom_owner_id == member_id)
            )

    assert asyncio.run(remaining()) == 0
