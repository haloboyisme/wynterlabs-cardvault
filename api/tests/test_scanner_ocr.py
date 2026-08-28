import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_admin_api import _authenticated_client

from app.models import Role
from app.scanner_ocr import DetectedLine, hints_from_lines


class FakeScannerOcr:
    def __init__(self) -> None:
        self.payloads: list[bytes] = []

    def recognize(self, payload: bytes):
        self.payloads.append(bytes(payload))
        return hints_from_lines(
            [
                DetectedLine("Voja, Jaws of the Conclave Qoe", 0.857, 12),
                DetectedLine("Legendary Creature — Wolf", 0.912, 420),
            ],
            image_height=720,
        )


@pytest.fixture
def owner_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        role=Role.OWNER,
        email="member-9bd10f1e74af@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        yield client


def test_private_ocr_requires_ready_authentication(client: TestClient) -> None:
    response = client.post(
        "/api/v1/scanner/recognize",
        content=b"private-photo",
        headers={"content-type": "image/jpeg"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_authenticated"


def test_private_ocr_reads_a_bounded_image_without_persisting_it(
    app: FastAPI, owner_client: TestClient
) -> None:
    service = FakeScannerOcr()
    app.state.scanner_ocr = service

    response = owner_client.post(
        "/api/v1/scanner/recognize",
        content=b"private-photo",
        headers={"content-type": "image/jpeg"},
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["title_candidates"][:2] == [
        "Voja, Jaws of the Conclave",
        "Voja, Jaws of the Conclave Qoe",
    ]
    assert service.payloads == [b"private-photo"]


def test_private_ocr_rejects_unsupported_and_oversized_uploads(
    owner_client: TestClient,
) -> None:
    unsupported = owner_client.post(
        "/api/v1/scanner/recognize",
        content=b"private-photo",
        headers={"content-type": "text/plain"},
    )
    assert unsupported.status_code == 415
    assert unsupported.json()["error"]["code"] == "unsupported_media_type"

    oversized = owner_client.post(
        "/api/v1/scanner/recognize",
        content=b"x" * (10 * 1024 * 1024 + 1),
        headers={"content-type": "image/jpeg"},
    )
    assert oversized.status_code == 422
    assert oversized.json()["error"]["code"] == "file_too_large"


def test_title_candidates_trim_model_noise_and_ignore_rules_text() -> None:
    hints = hints_from_lines(
        [
            DetectedLine("Voja, Jaws of the Conclave Qoe", 0.857, 15),
            DetectedLine("Whenever Voja attacks, put X +1/+1", 0.96, 430),
        ],
        image_height=720,
    )

    assert hints.title_candidates[:2] == [
        "Voja, Jaws of the Conclave",
        "Voja, Jaws of the Conclave Qoe",
    ]
    assert all("Whenever" not in value for value in hints.title_candidates)


@pytest.mark.parametrize(
    ("detail_line", "expected_set", "expected_collector"),
    [
        ("FDN 0234", "fdn", "0234"),
        ("M 2284 SLD EN", "sld", "2284"),
        ("MH3 0123", "mh3", "0123"),
        ("SVI 001/198", "svi", "001/198"),
    ],
)
def test_private_ocr_extracts_lower_left_set_and_collector_number(
    detail_line: str,
    expected_set: str,
    expected_collector: str,
) -> None:
    hints = hints_from_lines(
        [
            DetectedLine("Voja, Jaws of the Conclave", 0.96, 15),
            DetectedLine(detail_line, 0.91, 650),
        ],
        image_height=720,
    )

    assert hints.set == expected_set
    assert hints.collector == expected_collector


def test_private_ocr_prefers_fireshrieker_number_over_copyright_year() -> None:
    hints = hints_from_lines(
        [
            DetectedLine("Fireshrieker", 0.99, 24, 32),
            DetectedLine("U 0232", 0.99, 870, 32),
            DetectedLine("PIP EN XAVIER RIBEIRO", 0.94, 914, 32),
            DetectedLine("TM & © 2024 Wizards of the Coast", 0.98, 970, 220),
        ],
        image_height=1000,
        image_width=745,
    )

    assert hints.name == "Fireshrieker"
    assert hints.set == "pip"
    assert hints.collector == "0232"


def test_private_ocr_ignores_split_copyright_noise_below_codsworth_number() -> None:
    hints = hints_from_lines(
        [
            DetectedLine("Codsworth, Handy Helper", 0.99, 24, 32),
            DetectedLine("U 0366", 0.99, 870, 32),
            DetectedLine("PIP EN KAIER KONSTAD", 0.94, 914, 32),
            DetectedLine("18W", 0.82, 965, 220),
            DetectedLine("C2024", 0.98, 970, 220),
        ],
        image_height=1000,
        image_width=745,
    )

    assert hints.name == "Codsworth, Handy Helper"
    assert hints.set == "pip"
    assert hints.collector == "0366"
