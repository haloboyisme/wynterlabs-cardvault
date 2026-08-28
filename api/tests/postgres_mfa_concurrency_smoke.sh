#!/usr/bin/env bash
set -euo pipefail

api_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="${$}-${RANDOM}"
network="wynterlabs-mfa-race-${suffix}"
container="wynterlabs-mfa-race-pg-${suffix}"
user="mfa_race"
database="mfa_race"
password="test-only-credential-2a850a393b9f"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run -d --rm --name "$container" --network "$network" -e "POSTGRES_USER=$user" -e "POSTGRES_PASSWORD=$password" -e "POSTGRES_DB=$database" postgres:17.6-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$container" pg_isready -U "$user" -d "$database" >/dev/null 2>&1 && break; sleep 1; done
docker exec "$container" pg_isready -U "$user" -d "$database" >/dev/null
docker run --rm --network "$network" -v "$api_root:/app" -w /app \
  -e "CARDS_DATABASE_URL=postgresql+asyncpg://${user}:${password}@${container}:5432/${database}" \
  -e "CARDS_TEST_DATABASE_URL=postgresql+asyncpg://${user}:${password}@${container}:5432/${database}" \
  -e CARDS_BOOTSTRAP_SECRET_FILE=/tmp/unused -e CARDS_SESSION_PEPPER_FILE=/tmp/unused \
  -e CARDS_MFA_ENCRYPTION_KEY_FILE=/tmp/mfa-test-key python:3.13-slim sh -lc \
  "dd if=/dev/zero of=/tmp/mfa-test-key bs=32 count=1 status=none && pip install -q -e '.[dev]' && alembic upgrade head && pytest -q tests/postgres_mfa_concurrency_smoke.py"
echo "ephemeral-postgres-mfa-concurrency-smoke-ok"
