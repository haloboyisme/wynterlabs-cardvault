from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from app.dependencies import CurrentAuth, require_ready_auth
from app.errors import AppError
from app.scanner_ocr import RapidCardOcr, ScannerOcrError, ScannerOcrHints, scanner_ocr

router = APIRouter(prefix="/api/v1/scanner", tags=["scanner"])
MAX_IMAGE_BYTES = 10 * 1024 * 1024
SUPPORTED_IMAGES = {"image/jpeg", "image/png", "image/webp"}


def get_scanner_ocr(request: Request) -> RapidCardOcr:
    return getattr(request.app.state, "scanner_ocr", scanner_ocr)


@router.post("/recognize", response_model=ScannerOcrHints)
async def recognize_card(
    request: Request,
    response: Response,
    _auth: CurrentAuth = Depends(require_ready_auth),
    service: RapidCardOcr = Depends(get_scanner_ocr),
) -> ScannerOcrHints:
    media_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
    if media_type not in SUPPORTED_IMAGES:
        raise AppError(415, "unsupported_media_type", "Upload a JPEG, PNG, or WebP image.")
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > MAX_IMAGE_BYTES:
            raise AppError(422, "file_too_large", "Image exceeds the 10 MiB limit.")
        payload.extend(chunk)
    if not payload:
        raise AppError(422, "empty_image", "Upload one card image.")
    try:
        hints = await run_in_threadpool(service.recognize, payload)
    except ScannerOcrError as error:
        raise AppError(422, "invalid_image", str(error)) from error
    finally:
        payload.clear()
    response.headers["Cache-Control"] = "no-store"
    return hints
