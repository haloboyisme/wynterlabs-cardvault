import asyncio
import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from test_admin_api import _authenticated_client
from test_catalog_api import (
    BOLT_OTHER_PRINTING_ID,
    BOLT_PRINTING_ID,
    DELVER_PRINTING_ID,
    POKEMON_PRINTING_ID,
    STRIKE_PRINTING_ID,
    WISDOM_PRINTING_ID,
    _seed_catalog,
    _seed_supported_game_catalog,
)

from app.collection_constants import FORMATS
from app.models import CardPrinting, Deck, DeckCard, Role

OWNER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
MEMBER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


def _error(response, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def _create_deck(client: TestClient, **overrides):
    payload = {"name": "Friday Modern", "format": "modern", "description": "Private deck"}
    payload.update(overrides)
    return client.post("/api/v1/decks", json=payload)


def _set_card(
    client: TestClient,
    deck_id: str,
    *,
    printing_id: uuid.UUID = BOLT_PRINTING_ID,
    section: str = "mainboard",
    quantity: int = 1,
    expected_revision: int | None = None,
):
    payload = {
        "printing_id": str(printing_id),
        "section": section,
        "quantity": quantity,
    }
    if expected_revision is not None:
        payload["expected_revision"] = expected_revision
    return client.put(f"/api/v1/decks/{deck_id}/cards", json=payload)


def _update_card(
    client: TestClient,
    deck_id: str,
    card_id: str,
    *,
    section: str,
    quantity: int,
    expected_revision: int | None = None,
):
    payload = {"section": section, "quantity": quantity}
    if expected_revision is not None:
        payload["expected_revision"] = expected_revision
    return client.patch(f"/api/v1/decks/{deck_id}/cards/{card_id}", json=payload)


async def _set_printing_active(app: FastAPI, printing_id: uuid.UUID, active: bool) -> None:
    async with app.state.session_factory() as database:
        printing = await database.scalar(select(CardPrinting).where(CardPrinting.id == printing_id))
        assert printing is not None
        printing.active = active
        await database.commit()


async def _deck_counts(app: FastAPI) -> tuple[int, int]:
    async with app.state.session_factory() as database:
        return (
            int(await database.scalar(select(func.count()).select_from(Deck)) or 0),
            int(await database.scalar(select(func.count()).select_from(DeckCard)) or 0),
        )


@pytest.fixture
def owner_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-7c0f5f37e021@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        yield client


@pytest.fixture
def member_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=MEMBER_ID,
        role=Role.MEMBER,
        email="member-01c4db30259d@example.invalid",
        display_name="Wynter Member",
    ) as client:
        yield client


@pytest.fixture
def forced_admin_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        role=Role.ADMIN,
        email="member-4275c36417f0@example.invalid",
        display_name="Forced Administrator",
        must_change_password=True,
    ) as client:
        yield client


def test_deck_routes_require_ready_authentication(
    client: TestClient, app: FastAPI, forced_admin_client: TestClient
) -> None:
    _error(client.get("/api/v1/decks"), 401, "not_authenticated")
    _error(
        client.post("/api/v1/decks", json={"name": "Private", "format": "modern"}),
        401,
        "not_authenticated",
    )
    asyncio.run(_seed_catalog(app))
    _error(forced_admin_client.get("/api/v1/decks"), 403, "password_change_required")


def test_decks_are_private_even_from_owner_role(
    app: FastAPI, owner_client: TestClient, member_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    created = _create_deck(member_client, name="Member Private")
    assert created.status_code == 201
    deck_id = created.json()["id"]

    assert owner_client.get("/api/v1/decks").json()["total"] == 0
    _error(owner_client.get(f"/api/v1/decks/{deck_id}"), 404, "deck_not_found")
    _error(
        owner_client.patch(
            f"/api/v1/decks/{deck_id}",
            json={
                "name": "Stolen",
                "format": "modern",
                "description": None,
                "expected_revision": 1,
            },
        ),
        404,
        "deck_not_found",
    )
    _error(_set_card(owner_client, deck_id), 404, "deck_not_found")
    _error(
        owner_client.delete(f"/api/v1/decks/{deck_id}", params={"expected_revision": 1}),
        404,
        "deck_not_found",
    )


def test_accepts_game_appropriate_non_magic_deck_formats(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_supported_game_catalog(app))
    pokemon = _create_deck(
        owner_client,
        name="Pokémon Expanded",
        game="pokemon",
        format="expanded",
    )
    yugioh = _create_deck(
        owner_client,
        name="Yu-Gi-Oh! Advanced",
        game="yugioh",
        format="advanced",
    )

    assert pokemon.status_code == 201
    assert pokemon.json()["format"] == "expanded"
    assert yugioh.status_code == 201
    assert yugioh.json()["format"] == "advanced"


def test_deck_name_uniqueness_is_case_insensitive_and_per_user(
    app: FastAPI, owner_client: TestClient, member_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    assert _create_deck(owner_client, name="  Friday Modern  ").status_code == 201
    _error(_create_deck(owner_client, name="friday modern"), 409, "deck_name_conflict")
    assert _create_deck(member_client, name="FRIDAY MODERN").status_code == 201


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "   "},
        {"name": "x" * 121},
        {"format": "invented"},
        {"description": "x" * 2001},
    ],
)
def test_deck_metadata_bounds_are_validated(
    app: FastAPI, owner_client: TestClient, overrides: dict
) -> None:
    asyncio.run(_seed_catalog(app))
    _error(_create_deck(owner_client, **overrides), 422, "validation_error")


def test_deck_description_is_normalized_before_length_validation(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    blank = _create_deck(owner_client, name="Blank", description="   \n\t  ")
    assert blank.status_code == 201
    assert blank.json()["description"] is None

    padded = _create_deck(owner_client, name="Padded", description=f"  {'x' * 2000}  ")
    assert padded.status_code == 201
    assert padded.json()["description"] == "x" * 2000

    trimmed = _create_deck(owner_client, name="Trimmed", description=f"  {'x' * 2001}  ")
    _error(trimmed, 422, "validation_error")


def test_decks_have_a_valid_game_and_reject_cross_game_printings(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    asyncio.run(_seed_supported_game_catalog(app))

    legacy = _create_deck(owner_client, name="Legacy Default")
    assert legacy.status_code == 201
    assert legacy.json()["game"] == "mtg"

    pokemon = _create_deck(owner_client, name="Pokémon Deck", game="pokemon")
    assert pokemon.status_code == 201
    assert pokemon.json()["game"] == "pokemon"
    assert _create_deck(owner_client, name="Invalid Game", game="invented").status_code == 422

    _error(
        _set_card(owner_client, legacy.json()["id"], printing_id=POKEMON_PRINTING_ID),
        422,
        "deck_game_mismatch",
    )
    assert (
        _set_card(owner_client, pokemon.json()["id"], printing_id=POKEMON_PRINTING_ID).status_code
        == 200
    )


def test_deck_crud_and_metadata_revisions(app: FastAPI, owner_client: TestClient) -> None:
    asyncio.run(_seed_catalog(app))
    created = _create_deck(owner_client, description="")
    assert created.status_code == 201
    assert created.json()["description"] is None
    assert created.json()["revision"] == 1
    deck_id = created.json()["id"]
    assert owner_client.get("/api/v1/decks").json()["items"][0]["id"] == deck_id

    updated = owner_client.patch(
        f"/api/v1/decks/{deck_id}",
        json={
            "name": "Friday Legacy",
            "format": "legacy",
            "description": "Updated",
            "expected_revision": 1,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2
    assert updated.json()["name"] == "Friday Legacy"
    _error(
        owner_client.patch(
            f"/api/v1/decks/{deck_id}",
            json={
                "name": "Stale",
                "format": "modern",
                "description": None,
                "expected_revision": 1,
            },
        ),
        409,
        "deck_stale",
    )
    _error(owner_client.delete(f"/api/v1/decks/{deck_id}"), 422, "validation_error")
    _error(
        owner_client.delete(f"/api/v1/decks/{deck_id}", params={"expected_revision": 1}),
        409,
        "deck_stale",
    )
    assert (
        owner_client.delete(f"/api/v1/decks/{deck_id}", params={"expected_revision": 2}).status_code
        == 204
    )
    _error(owner_client.get(f"/api/v1/decks/{deck_id}"), 404, "deck_not_found")


def test_card_set_is_target_section_only_and_revision_safe(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    deck_id = _create_deck(owner_client).json()["id"]
    created = _set_card(owner_client, deck_id, quantity=2)
    assert created.status_code == 200
    card = created.json()["cards"][0]
    assert card["quantity"] == 2
    assert card["revision"] == 1

    _error(_set_card(owner_client, deck_id, quantity=3), 422, "deck_card_revision_required")
    unchanged = owner_client.get(f"/api/v1/decks/{deck_id}").json()["cards"]
    assert [(entry["section"], entry["quantity"], entry["revision"]) for entry in unchanged] == [
        ("mainboard", 2, 1)
    ]
    _error(
        _set_card(owner_client, deck_id, quantity=4, expected_revision=9),
        409,
        "deck_card_stale",
    )
    updated = _set_card(owner_client, deck_id, quantity=3, expected_revision=1)
    assert updated.status_code == 200
    assert len(updated.json()["cards"]) == 1
    assert updated.json()["cards"][0]["id"] == card["id"]
    assert updated.json()["cards"][0]["revision"] == 2
    _error(
        _set_card(owner_client, deck_id, quantity=4, expected_revision=1),
        409,
        "deck_card_stale",
    )

    second_section = _set_card(
        owner_client,
        deck_id,
        section="sideboard",
        quantity=1,
    )
    assert second_section.status_code == 200
    assert [(entry["section"], entry["id"]) for entry in second_section.json()["cards"]] == [
        ("mainboard", card["id"]),
        ("sideboard", second_section.json()["cards"][1]["id"]),
    ]
    _error(
        _set_card(
            owner_client,
            deck_id,
            section="companion",
            expected_revision=2,
        ),
        409,
        "deck_card_stale",
    )


def test_card_patch_moves_one_row_and_rejects_stale_collision_and_cross_user(
    app: FastAPI, owner_client: TestClient, member_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    deck_id = _create_deck(owner_client).json()["id"]
    first = _set_card(owner_client, deck_id, quantity=2).json()["cards"][0]
    sideboard_detail = _set_card(owner_client, deck_id, section="sideboard", quantity=1).json()
    sideboard = next(card for card in sideboard_detail["cards"] if card["section"] == "sideboard")

    _error(
        _update_card(
            owner_client,
            deck_id,
            first["id"],
            section="companion",
            quantity=4,
        ),
        422,
        "validation_error",
    )
    _error(
        _update_card(
            owner_client,
            deck_id,
            first["id"],
            section="companion",
            quantity=4,
            expected_revision=9,
        ),
        409,
        "deck_card_stale",
    )
    before_move_detail = owner_client.get(f"/api/v1/decks/{deck_id}").json()
    assert before_move_detail["revision"] == 3
    before_move = before_move_detail["cards"]
    assert [(card["id"], card["section"], card["quantity"]) for card in before_move] == [
        (first["id"], "mainboard", 2),
        (sideboard["id"], "sideboard", 1),
    ]

    moved = _update_card(
        owner_client,
        deck_id,
        first["id"],
        section="companion",
        quantity=4,
        expected_revision=1,
    )
    assert moved.status_code == 200
    assert moved.json()["revision"] == 4
    moved_card = next(card for card in moved.json()["cards"] if card["id"] == first["id"])
    assert (moved_card["section"], moved_card["quantity"], moved_card["revision"]) == (
        "companion",
        4,
        2,
    )
    assert any(card["id"] == sideboard["id"] for card in moved.json()["cards"])

    _error(
        _update_card(
            owner_client,
            deck_id,
            first["id"],
            section="sideboard",
            quantity=4,
            expected_revision=2,
        ),
        409,
        "deck_card_conflict",
    )
    _error(
        _update_card(
            owner_client,
            deck_id,
            first["id"],
            section="commander",
            quantity=4,
            expected_revision=2,
        ),
        422,
        "deck_section_not_allowed",
    )
    _error(
        _update_card(
            member_client,
            deck_id,
            first["id"],
            section="mainboard",
            quantity=1,
            expected_revision=2,
        ),
        404,
        "deck_not_found",
    )
    preserved_detail = owner_client.get(f"/api/v1/decks/{deck_id}").json()
    assert preserved_detail["revision"] == 4
    preserved = preserved_detail["cards"]
    assert [
        (card["id"], card["section"], card["quantity"], card["revision"]) for card in preserved
    ] == [
        (sideboard["id"], "sideboard", 1, 1),
        (first["id"], "companion", 4, 2),
    ]


def test_card_remove_is_revision_safe(app: FastAPI, owner_client: TestClient) -> None:
    asyncio.run(_seed_catalog(app))
    deck_id = _create_deck(owner_client).json()["id"]
    card = _set_card(owner_client, deck_id, quantity=2).json()["cards"][0]
    _error(
        owner_client.delete(
            f"/api/v1/decks/{deck_id}/cards/{card['id']}",
            params={"expected_revision": 9},
        ),
        409,
        "deck_card_stale",
    )
    assert (
        owner_client.delete(
            f"/api/v1/decks/{deck_id}/cards/{card['id']}",
            params={"expected_revision": 1},
        ).status_code
        == 204
    )
    assert owner_client.get(f"/api/v1/decks/{deck_id}").json()["cards"] == []


def test_format_sections_are_enforced_and_incompatible_format_change_is_refused(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    modern = _create_deck(owner_client, name="Modern").json()
    _error(
        _set_card(owner_client, modern["id"], section="commander"),
        422,
        "deck_section_not_allowed",
    )
    commander = _create_deck(owner_client, name="Commander", format="commander").json()
    assert _set_card(owner_client, commander["id"], section="commander").status_code == 200
    _error(
        owner_client.patch(
            f"/api/v1/decks/{commander['id']}",
            json={
                "name": "Commander",
                "format": "modern",
                "description": None,
                "expected_revision": 2,
            },
        ),
        422,
        "deck_section_not_allowed",
    )
    oathbreaker = _create_deck(owner_client, name="Oath", format="oathbreaker").json()
    assert _set_card(owner_client, oathbreaker["id"], section="oathbreaker").status_code == 200
    assert (
        _set_card(
            owner_client,
            oathbreaker["id"],
            printing_id=STRIKE_PRINTING_ID,
            section="signature_spell",
        ).status_code
        == 200
    )


def test_card_quantity_bounds_and_missing_printing_are_validated(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    deck_id = _create_deck(owner_client).json()["id"]
    _error(_set_card(owner_client, deck_id, quantity=0), 422, "validation_error")
    _error(_set_card(owner_client, deck_id, quantity=10000), 422, "validation_error")
    _error(
        _set_card(owner_client, deck_id, printing_id=uuid.uuid4()),
        404,
        "printing_not_found",
    )


def test_inactive_printing_cannot_be_newly_added_but_existing_card_is_preserved(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    existing_id = _create_deck(owner_client, name="Existing").json()["id"]
    assert _set_card(owner_client, existing_id).status_code == 200
    asyncio.run(_set_printing_active(app, BOLT_PRINTING_ID, False))
    detail = owner_client.get(f"/api/v1/decks/{existing_id}")
    assert detail.status_code == 200
    assert detail.json()["cards"][0]["printing_id"] == str(BOLT_PRINTING_ID)

    new_id = _create_deck(owner_client, name="New").json()["id"]
    _error(_set_card(owner_client, new_id), 404, "printing_not_found")


def test_detail_batches_exact_printing_ownership_and_reports_shortage(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    for finish, quantity in (("nonfoil", 2), ("foil", 3)):
        response = owner_client.post(
            "/api/v1/collection/items",
            json={
                "printing_id": str(BOLT_PRINTING_ID),
                "finish": finish,
                "condition": "near_mint",
                "quantity": quantity,
            },
        )
        assert response.status_code == 201
    assert (
        owner_client.post(
            "/api/v1/collection/items",
            json={
                "printing_id": str(BOLT_OTHER_PRINTING_ID),
                "finish": "foil",
                "condition": "near_mint",
                "quantity": 9,
            },
        ).status_code
        == 201
    )

    deck_id = _create_deck(owner_client).json()["id"]
    detail = _set_card(owner_client, deck_id, quantity=6).json()
    assert detail["cards"][0]["owned_quantity"] == 5
    shortage = next(
        warning for warning in detail["warnings"] if warning["code"] == "ownership_shortage"
    )
    assert shortage["printing_id"] == str(BOLT_PRINTING_ID)


def test_detail_orders_sections_then_card_names_deterministically(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    deck_id = _create_deck(owner_client).json()["id"]
    assert (
        _set_card(
            owner_client, deck_id, printing_id=DELVER_PRINTING_ID, section="sideboard"
        ).status_code
        == 200
    )
    assert (
        _set_card(
            owner_client, deck_id, printing_id=WISDOM_PRINTING_ID, section="companion"
        ).status_code
        == 200
    )
    assert (
        _set_card(
            owner_client,
            deck_id,
            printing_id=BOLT_OTHER_PRINTING_ID,
            section="maybeboard",
        ).status_code
        == 200
    )

    assert _set_card(owner_client, deck_id, printing_id=STRIKE_PRINTING_ID).status_code == 200
    detail = _set_card(owner_client, deck_id, printing_id=BOLT_PRINTING_ID).json()

    assert [(card["section"], card["card"]["name"]) for card in detail["cards"]] == [
        ("mainboard", "Lightning Bolt"),
        ("mainboard", "Lightning Strike"),
        ("sideboard", "Delver of Secrets // Insectile Aberration"),
        ("companion", "Forest's Wisdom"),
        ("maybeboard", "Lightning Bolt"),
    ]


def test_deleting_deck_cascades_its_cards(app: FastAPI, owner_client: TestClient) -> None:
    asyncio.run(_seed_catalog(app))
    deck = _create_deck(owner_client).json()
    assert _set_card(owner_client, deck["id"]).status_code == 200
    assert asyncio.run(_deck_counts(app)) == (1, 1)
    assert (
        owner_client.delete(
            f"/api/v1/decks/{deck['id']}", params={"expected_revision": 2}
        ).status_code
        == 204
    )
    assert asyncio.run(_deck_counts(app)) == (0, 0)


def test_catalog_format_filter_regression_uses_shared_allow_list(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    assert "modern" in FORMATS
    response = owner_client.get("/api/v1/catalog/cards", params={"legality": "modern"})
    assert response.status_code == 200
    assert response.json()["total"] == 4


def test_deck_detail_query_count_is_bounded_not_per_card(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    deck_id = _create_deck(owner_client).json()["id"]
    for printing_id in (BOLT_PRINTING_ID, STRIKE_PRINTING_ID, DELVER_PRINTING_ID):
        assert _set_card(owner_client, deck_id, printing_id=printing_id).status_code == 200

    statements: list[str] = []

    def count_selects(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = app.state.session_factory.kw["bind"]
    event.listen(engine.sync_engine, "before_cursor_execute", count_selects)
    try:
        response = owner_client.get(f"/api/v1/decks/{deck_id}")
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count_selects)

    assert response.status_code == 200
    assert len(response.json()["cards"]) == 3
    assert len(statements) <= 5
