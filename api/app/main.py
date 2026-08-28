from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.database import create_engine, create_session_factory
from app.errors import install_error_handlers
from app.routers import (
    account,
    admin,
    auth,
    catalog,
    collection,
    decks,
    health,
    invitations,
    mfa,
    scanner,
    setup,
    trades,
)


def create_app(
    settings: Settings | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings()
    _ = resolved_settings.mfa_encryption_key
    if session_factory is None:
        session_factory = create_session_factory(create_engine(resolved_settings))

    app = FastAPI(
        title="WynterLabs Cards API",
        version="0.3.0",
        docs_url=None if resolved_settings.environment == "production" else "/api/docs",
    )
    app.state.settings = resolved_settings
    app.state.session_factory = session_factory
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(setup.router)
    app.include_router(scanner.router)
    app.include_router(catalog.router)
    app.include_router(collection.router)
    app.include_router(decks.router)
    app.include_router(invitations.router)
    app.include_router(trades.router)
    app.include_router(admin.router)
    app.include_router(auth.router)
    app.include_router(account.router)
    app.include_router(mfa.router)
    return app
