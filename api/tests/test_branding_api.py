import base64
import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import Role
from test_admin_api import _authenticated_client

OWNER_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")
ADMIN_ID = uuid.UUID("66666666-6666-6666-6666-666666666666")
MEMBER_ID = uuid.UUID("77777777-7777-7777-7777-777777777777")


DEFAULT_BRANDING = {
    "site_name": "WynterLabs",
    "product_name": "CardVault",
    "tagline": "Scan it. Sort it. Own your collection.",
    "has_custom_logo": False,
    "logo_revision": None,
}


def _logo_data_url(media_type: str, content: bytes) -> str:
    return f"data:{media_type};base64,{base64.b64encode(content).decode()}"


def _branding_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "site_name": "Winter Lab",
        "product_name": "Cards",
        "tagline": "Private collection",
        "logo_data_url": None,
    }
    payload.update(overrides)
    return payload


def _png_chunk(chunk_type: bytes, content: bytes) -> bytes:
    return len(content).to_bytes(4, "big") + chunk_type + content + b"\x00\x00\x00\x00"


@pytest.fixture
def owner_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="branding-owner@example.invalid",
        display_name="Branding Owner",
    ) as client:
        yield client


@pytest.fixture
def admin_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=ADMIN_ID,
        role=Role.ADMIN,
        email="branding-admin@example.invalid",
        display_name="Branding Administrator",
    ) as client:
        yield client


@pytest.fixture
def member_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=MEMBER_ID,
        role=Role.MEMBER,
        email="branding-member@example.invalid",
        display_name="Branding Member",
    ) as client:
        yield client


def test_branding_defaults_for_signed_in_member(member_client: TestClient):
    response = member_client.get("/api/v1/branding")
    assert response.status_code == 200
    assert response.json() == DEFAULT_BRANDING


def test_member_cannot_update_branding(member_client: TestClient):
    response = member_client.put(
        "/api/v1/admin/branding",
        json={
            "site_name": "Winter Lab",
            "product_name": "Cards",
            "tagline": "Private collection",
            "logo_data_url": None,
        },
    )
    assert response.status_code == 403


def test_missing_custom_logo_returns_not_found(member_client: TestClient):
    response = member_client.get("/api/v1/branding/logo")
    assert response.status_code == 404


@pytest.mark.parametrize("client_fixture", ["owner_client", "admin_client"])
def test_owner_and_admin_can_save_normalized_branding(request, client_fixture: str):
    client = request.getfixturevalue(client_fixture)
    response = client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(
            site_name="  Winter Lab  ",
            product_name="  Cards  ",
            tagline="  Private collection  ",
        ),
    )
    assert response.status_code == 200
    assert response.json() == {
        "site_name": "Winter Lab",
        "product_name": "Cards",
        "tagline": "Private collection",
        "has_custom_logo": False,
        "logo_revision": None,
    }


@pytest.mark.parametrize(
    "payload",
    [
        _branding_payload(site_name="W"),
        _branding_payload(product_name="C"),
        _branding_payload(tagline="x" * 101),
        _branding_payload(site_name="  "),
        _branding_payload(product_name="  "),
    ],
)
def test_branding_rejects_invalid_text(owner_client: TestClient, payload: dict[str, object]):
    response = owner_client.put("/api/v1/admin/branding", json=payload)
    assert response.status_code == 422


@pytest.mark.parametrize(
    ("media_type", "content"),
    [
        ("image/png", b"\x89PNG\r\n\x1a\nvalid png"),
        ("image/jpeg", b"\xff\xd8\xffvalid jpeg"),
        ("image/webp", b"RIFF\x00\x00\x00\x00WEBPvalid webp"),
    ],
)
def test_branding_accepts_supported_logo_signatures(
    owner_client: TestClient, media_type: str, content: bytes
):
    response = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(logo_data_url=_logo_data_url(media_type, content)),
    )
    assert response.status_code == 200
    assert response.json()["has_custom_logo"] is True
    assert len(response.json()["logo_revision"]) == 64


@pytest.mark.parametrize(
    "data_url",
    [
        _logo_data_url("image/svg+xml", b"<svg />"),
        _logo_data_url("image/gif", b"GIF89a"),
        "data:image/png;base64,not valid base64!",
        _logo_data_url("image/png", b"\xff\xd8\xffjpeg bytes"),
        _logo_data_url("image/webp", b"RIFF\x00\x00\x00\x00NOPEwrong webp"),
        _logo_data_url("image/png", b"\x89PNG\r\n\x1a\n" + b"x" * 524_281),
    ],
)
def test_branding_rejects_unsafe_logo_data(owner_client: TestClient, data_url: str):
    response = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(logo_data_url=data_url),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_brand_logo"


@pytest.mark.parametrize(
    ("media_type", "content"),
    [
        (
            "image/png",
            b"\x89PNG\r\n\x1a\n"
            + _png_chunk(b"IHDR", b"\x00" * 13)
            + _png_chunk(b"acTL", b"\x00" * 8),
        ),
        (
            "image/webp",
            b"RIFF\x16\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x02" + b"\x00" * 9,
        ),
    ],
)
def test_branding_rejects_animated_logo_data(
    owner_client: TestClient, media_type: str, content: bytes
):
    response = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(logo_data_url=_logo_data_url(media_type, content)),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_brand_logo"
    assert response.json()["error"]["message"] == (
        "Choose a PNG, JPEG, or WebP logo no larger than 512 KB."
    )


@pytest.mark.parametrize("logo_data_url", [{}, [], 7, True])
def test_branding_rejects_non_string_logo_data_with_logo_error(
    owner_client: TestClient, logo_data_url: object
):
    response = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(logo_data_url=logo_data_url),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_brand_logo"
    assert response.json()["error"]["message"] == (
        "Choose a PNG, JPEG, or WebP logo no larger than 512 KB."
    )


def test_failed_branding_update_preserves_last_valid_row(owner_client: TestClient):
    saved = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(site_name="Protected Name"),
    )
    assert saved.status_code == 200

    failed = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(site_name="Broken", logo_data_url="data:image/png;base64,broken!"),
    )
    assert failed.status_code == 422

    current = owner_client.get("/api/v1/branding")
    assert current.status_code == 200
    assert current.json()["site_name"] == "Protected Name"


def test_logo_response_has_fixed_safe_headers(owner_client: TestClient):
    logo = b"\x89PNG\r\n\x1a\nbrand image"
    saved = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(logo_data_url=_logo_data_url("image/png", logo)),
    )
    assert saved.status_code == 200

    response = owner_client.get("/api/v1/branding/logo")
    assert response.status_code == 200
    assert response.content == logo
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "private, max-age=3600"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["etag"] == saved.json()["logo_revision"]


def test_delete_logo_preserves_branding_text(owner_client: TestClient):
    saved = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(
            site_name="Kept Name",
            logo_data_url=_logo_data_url("image/jpeg", b"\xff\xd8\xffbrand image"),
        ),
    )
    assert saved.status_code == 200

    response = owner_client.delete("/api/v1/admin/branding/logo")
    assert response.status_code == 200
    assert response.json() == {
        "site_name": "Kept Name",
        "product_name": "Cards",
        "tagline": "Private collection",
        "has_custom_logo": False,
        "logo_revision": None,
    }


def test_text_update_without_logo_retains_existing_logo(owner_client: TestClient):
    logo = b"\x89PNG\r\n\x1a\nkept logo"
    saved = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(logo_data_url=_logo_data_url("image/png", logo)),
    )
    assert saved.status_code == 200
    revision = saved.json()["logo_revision"]

    updated = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(site_name="Updated Name"),
    )
    assert updated.status_code == 200
    assert updated.json()["logo_revision"] == revision

    response = owner_client.get("/api/v1/branding/logo")
    assert response.status_code == 200
    assert response.content == logo


def test_reset_returns_builtin_defaults(owner_client: TestClient):
    saved = owner_client.put(
        "/api/v1/admin/branding",
        json=_branding_payload(site_name="Temporary Name"),
    )
    assert saved.status_code == 200

    response = owner_client.post("/api/v1/admin/branding/reset")
    assert response.status_code == 200
    assert response.json() == DEFAULT_BRANDING


def test_unauthenticated_branding_reads_require_a_session(client: TestClient):
    branding = client.get("/api/v1/branding")
    logo = client.get("/api/v1/branding/logo")
    assert branding.status_code == 401
    assert logo.status_code == 401
