import asyncio
import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import select, update
from datetime import UTC, datetime, timedelta
from app.database import Base, get_db
from app.dependencies import require_ready_auth
from app.errors import install_error_handlers
from app.models import ScanFailure
from app.routers.scan_failures import router

@pytest.fixture
def client(tmp_path):
    engine=create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/log.db")
    factory=async_sessionmaker(engine,expire_on_commit=False)
    async def schema():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    asyncio.run(schema())
    app=FastAPI();app.include_router(router);install_error_handlers(app)
    user=SimpleNamespace(id=uuid.uuid4(),role="member")
    async def db():
        async with factory() as session:yield session
    app.dependency_overrides[get_db]=db
    app.dependency_overrides[require_ready_auth]=lambda:SimpleNamespace(user=user)
    with TestClient(app) as http:yield http,user,factory
    asyncio.run(engine.dispose())

def payload(**changes):
    return dict(mode="multiple",revision=1,attempts=1,outcome="unresolved",reasons=["no_catalog_match"],suspected=["blur"],reported=[],**changes)

def test_idempotent_recovery_and_account_isolation(client):
    http,user,_=client;scan=uuid.uuid4();path=f"/api/v1/scanner/failures/{scan}"
    body=payload()
    assert http.put(path,json=body).status_code==200
    assert http.put(path,json=body).status_code==200
    updated={**body,"revision":2,"attempts":2,"outcome":"recovered_by_retry"}
    assert http.put(path,json=updated).status_code==200
    http.put(path,json=body)
    rows=http.get('/api/v1/scanner/failures').json()['items']
    assert len(rows)==1 and rows[0]['outcome']=='recovered_by_retry' and rows[0]['reasons']==['no_catalog_match']
    user.id=uuid.uuid4()
    assert http.get('/api/v1/scanner/failures').json()['items']==[]
    assert http.get('/api/v1/scanner/failures?all_accounts=true').status_code==403
    http.put(path,json={**body,'reported':['wrong_match']})
    assert len(http.get('/api/v1/scanner/failures').json()['items'])==1
    user.role='admin'
    assert len(http.get('/api/v1/scanner/failures?all_accounts=true').json()['items'])==2

def test_rejects_photos_unknown_tags_and_unbounded_values(client):
    http,_,_=client;path=f'/api/v1/scanner/failures/{uuid.uuid4()}'
    for changes in [{'photo':'data:image/jpeg;base64,private'}, {'reasons':['made_up']}, {'attempts':1001}, {'revision':0}, {'mode':'other'}, {'reasons':[], 'reported':[]}]:
        assert http.put(path,json={**payload(),**changes}).status_code==422

def test_retention_removes_old_rows(client):
    http,user,factory=client;scan=uuid.uuid4();http.put(f'/api/v1/scanner/failures/{scan}',json=payload())
    async def age():
        async with factory() as db:
            await db.execute(update(ScanFailure).values(created_at=datetime.now(UTC)-timedelta(days=91)))
            await db.commit()
    asyncio.run(age())
    assert http.get('/api/v1/scanner/failures').json()['items']==[]
    http.put(f'/api/v1/scanner/failures/{uuid.uuid4()}',json=payload())
    async def count():
        async with factory() as db:return len((await db.execute(select(ScanFailure))).scalars().all())
    assert asyncio.run(count())==1
