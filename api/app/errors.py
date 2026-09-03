import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(
        self, status_code: int, code: str, message: str, *, headers: dict[str, str] | None = None
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers


def error_payload(
    code: str,
    message: str,
    request_id: str,
    fields: Any | None = None,
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "fields": fields,
            "request_id": request_id,
        }
    }


def install_error_handlers(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request.state.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        try:
            response = await call_next(request)
        finally:
            if request.url.path == "/api/v1/auth/google/callback":
                # Cover successful responses and downstream failures alike.
                request.scope["query_string"] = b""
        response.headers["X-Request-ID"] = request.state.request_id
        if request.url.path.startswith(
            (
                "/api/v1/invitations",
                "/api/v1/admin/invitations",
                "/api/v1/scanner",
                "/api/v1/account/mfa",
                "/api/v1/auth/mfa",
                "/api/v1/email",
                "/api/v1/admin/email",
                "/api/v1/auth/google",
                "/api/v1/account/google",
                "/api/v1/admin/google",
            )
        ):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(exc.code, exc.message, request.state.request_id),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        fields = [
            {"field": ".".join(str(part) for part in error["loc"][1:]), "message": error["msg"]}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_payload(
                "validation_error",
                "Check the submitted fields.",
                request.state.request_id,
                fields,
            ),
        )
