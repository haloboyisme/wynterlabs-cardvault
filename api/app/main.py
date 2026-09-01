import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import registration
from app.config import Settings
from app.catalog.scheduler import catalog_scheduler_loop
from app.database import create_engine, create_session_factory
from app.errors import install_error_handlers
from app.routers import (
    account,
    admin,
    auth,
    branding,
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

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        task = asyncio.create_task(
            catalog_scheduler_loop(resolved_settings, session_factory),
            name="catalog-refresh-scheduler",
        )
        application.state.catalog_scheduler_task = task
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    app = FastAPI(
        title="WynterLabs CardVault API",
        version="0.3.0",
        docs_url=None if resolved_settings.environment == "production" else "/api/docs",
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    app.state.session_factory = session_factory
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(branding.router)
    app.include_router(setup.router)
    app.include_router(scanner.router)
    app.include_router(catalog.router)
    app.include_router(collection.router)
    app.include_router(decks.router)
    app.include_router(invitations.router)
    app.include_router(registration.router)
    app.include_router(trades.router)
    app.include_router(admin.router)
    app.include_router(auth.router)
    app.include_router(account.router)
    app.include_router(mfa.router)
    return app
