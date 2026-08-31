#!/usr/bin/env bash
set -euo pipefail

api_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="${$}-${RANDOM}"
network_name="wynterlabs-collection-value-migration-${suffix}"
database_container="wynterlabs-collection-value-migration-pg-${suffix}"
database_user="collection_value_migration"
database_name="collection_value_migration"
database_password="test-only-credential-7d7f943fa5a1"
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

alembic() {
  docker run --rm --network "${network_name}" --volume "${api_root}:/app" --workdir /app \
    --env "CARDS_DATABASE_URL=${database_url}" \
    --env CARDS_BOOTSTRAP_SECRET_FILE=/tmp/unused \
    --env CARDS_SESSION_PEPPER_FILE=/tmp/unused \
    --env CARDS_MFA_ENCRYPTION_KEY_FILE=/tmp/mfa-test-key python:3.13-slim sh -lc \
    "dd if=/dev/zero of=/tmp/mfa-test-key bs=32 count=1 status=none && pip install -q -e . && alembic $*"
}

query() {
  docker exec --env "PGPASSWORD=${database_password}" "${database_container}" \
    psql --username "${database_user}" --dbname "${database_name}" --tuples-only --no-align \
    --command "$1"
}

expect() {
  local expected="$1"
  local sql="$2"
  local actual
  actual="$(query "${sql}")"
  test "${actual}" = "${expected}"
}

alembic upgrade 0010_multi_game_catalog
query "INSERT INTO users (id,email,email_normalized,display_name,display_name_normalized,password_hash,role,owner_slot,is_active,must_change_password,password_changed_at,created_at,updated_at) VALUES ('11111111-1111-1111-1111-111111111111','member-b84e8dda5ae1@example.invalid','member-3e40761622bd@example.invalid','Owner','owner','hash','OWNER',1,true,false,now(),now(),now());"
alembic upgrade head
expect "0016_trusted_mfa_browser" "SELECT version_num FROM alembic_version"
expect "1" "SELECT count(*) FROM information_schema.tables WHERE table_name = 'collection_value_snapshots'"
expect "1" "SELECT count(*) FROM pg_constraint WHERE conname = 'uq_collection_value_snapshots_user_minute'"
expect "1" "SELECT count(*) FROM pg_indexes WHERE indexname = 'ix_collection_value_snapshots_user_captured'"
expect "1" "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'"
expect "1" "SELECT count(*) FROM pg_constraint WHERE conname = 'ck_site_branding_singleton'"
query "INSERT INTO collection_value_snapshots (id,user_id,minute_bucket,captured_at,estimated_value_usd,priced_copies,unpriced_copies,total_copies,oldest_price_snapshot_at,trigger) VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',now(),now(),0,0,0,0,NULL,'view');"
expect "1" "SELECT count(*) FROM collection_value_snapshots"
alembic downgrade 0011_collection_value_history
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version"
expect "0" "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'"
expect "1" "SELECT count(*) FROM collection_value_snapshots"
alembic upgrade head
expect "0016_trusted_mfa_browser" "SELECT version_num FROM alembic_version"
expect "1" "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'"
alembic downgrade 0010_multi_game_catalog
expect "0010_multi_game_catalog" "SELECT version_num FROM alembic_version"
expect "0" "SELECT count(*) FROM information_schema.tables WHERE table_name = 'collection_value_snapshots'"
expect "0" "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'"
alembic upgrade head
expect "0016_trusted_mfa_browser" "SELECT version_num FROM alembic_version"
expect "1" "SELECT count(*) FROM information_schema.tables WHERE table_name = 'collection_value_snapshots'"
expect "1" "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'"
echo "ephemeral-postgres-collection-value-history-migration-smoke-ok"
