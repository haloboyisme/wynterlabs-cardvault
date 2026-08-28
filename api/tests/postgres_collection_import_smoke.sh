#!/usr/bin/env bash
set -euo pipefail

api_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="${$}-${RANDOM}"
network_name="wynterlabs-collection-import-${suffix}"
database_container="wynterlabs-collection-import-pg-${suffix}"
database_user="collection_import"
database_name="collection_import"
database_password="test-only-credential-f70b0938c74b"
database_url="postgresql+asyncpg://${database_user}:${database_password}@${database_container}:5432/${database_name}"

cleanup() {
  docker rm -f "${database_container}" >/dev/null 2>&1 || true
  docker network rm "${network_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "${network_name}" >/dev/null
docker run --detach --rm --name "${database_container}" --network "${network_name}" \
  --env "POSTGRES_USER=${database_user}" --env "POSTGRES_PASSWORD=${database_password}" \
  --env "POSTGRES_DB=${database_name}" postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do
  if docker exec "${database_container}" pg_isready --username "${database_user}" \
    --dbname "${database_name}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "${database_container}" pg_isready --username "${database_user}" \
  --dbname "${database_name}" >/dev/null

docker run --rm --network "${network_name}" --volume "${api_root}:/app" --workdir /app \
  --env "CARDS_DATABASE_URL=${database_url}" --env "CARDS_TEST_DATABASE_URL=${database_url}" \
  --env CARDS_BOOTSTRAP_SECRET_FILE=/tmp/unused \
  --env CARDS_SESSION_PEPPER_FILE=/tmp/unused --env CARDS_MFA_ENCRYPTION_KEY_FILE=/tmp/mfa-test-key python:3.13-slim sh -lc \
  "dd if=/dev/zero of=/tmp/mfa-test-key bs=32 count=1 status=none && pip install -q -e '.[dev]' && alembic upgrade head && python tests/postgres_collection_import_smoke.py"
