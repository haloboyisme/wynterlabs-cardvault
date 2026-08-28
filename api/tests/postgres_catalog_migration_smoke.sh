#!/usr/bin/env bash
set -euo pipefail

api_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="${$}-${RANDOM}"
network_name="wynterlabs-catalog-smoke-${suffix}"
database_container="wynterlabs-catalog-pg-${suffix}"
database_user="catalog_smoke"
database_name="catalog_smoke"
database_password="test-only-credential-665da108026b"
writer_fifo=""
migration_log=""
migration_status=""

cleanup() {
  if [[ -n "${writer_fifo}" ]]; then
    rm -f -- "${writer_fifo}"
  fi
  rm -f -- "${migration_log}" "${migration_status}"
  docker rm -f "${database_container}" >/dev/null 2>&1 || true
  docker network rm "${network_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "${network_name}" >/dev/null
docker run --detach --rm \
  --name "${database_container}" \
  --network "${network_name}" \
  --env "POSTGRES_USER=${database_user}" \
  --env "POSTGRES_PASSWORD=${database_password}" \
  --env "POSTGRES_DB=${database_name}" \
  postgres:17-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "${database_container}" pg_isready \
    --username "${database_user}" --dbname "${database_name}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "${database_container}" pg_isready \
  --username "${database_user}" --dbname "${database_name}" >/dev/null

run_alembic() {
  docker run --rm \
    --network "${network_name}" \
    --volume "${api_root}:/app" \
    --workdir /app \
    --env "CARDS_DATABASE_URL=postgresql+asyncpg://${database_user}:${database_password}@${database_container}:5432/${database_name}" \
    --env CARDS_BOOTSTRAP_SECRET_FILE=/tmp/unused \
    --env CARDS_SESSION_PEPPER_FILE=/tmp/unused \
    --env CARDS_MFA_ENCRYPTION_KEY_FILE=/tmp/mfa-test-key \
    python:3.13-slim sh -lc \
    "dd if=/dev/zero of=/tmp/mfa-test-key bs=32 count=1 status=none && pip install -q -e . && alembic $*"
}

query() {
  docker exec \
    --env "PGPASSWORD=${database_password}" \
    "${database_container}" \
    psql --username "${database_user}" --dbname "${database_name}" \
    --tuples-only --no-align --command "$1"
}

expect() {
  local expected="$1"
  local sql="$2"
  local actual
  actual="$(query "${sql}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "catalog migration smoke assertion failed: expected '${expected}', got '${actual}'" >&2
    echo "query: ${sql}" >&2
    exit 1
  fi
}

run_alembic upgrade 0002_catalog
query "INSERT INTO users (id, email, email_normalized, display_name, display_name_normalized, password_hash, role, owner_slot, is_active, password_changed_at, created_at, updated_at) VALUES ('11111111-1111-1111-1111-111111111111', 'member-1ab00d0915ec@example.invalid', 'member-aa67ef8b1ad6@example.invalid', 'Wynter Owner', 'wynter owner', 'not-a-real-password-hash', 'OWNER', 1, TRUE, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
run_alembic upgrade head

expect "t" "SELECT version_num = '0011_collection_value_history' FROM alembic_version;"
expect "1" "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'collection_items' AND column_name = 'manual_price_usd' AND data_type = 'numeric';"
expect "1" "SELECT count(*) FROM pg_constraint WHERE conname = 'ck_collection_items_manual_price_usd';"
expect "6" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('trading_accounts','trade_listings','want_listings','trade_reports','trade_strikes','trade_moderation_events');"
expect "1" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'collection_import_previews';"
expect "1" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'account_invitations';"
expected_admin_roles=$'OWNER\nMEMBER\nADMIN'
expect "${expected_admin_roles}" "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid WHERE pg_type.typname = 'role' ORDER BY enumsortorder;"
expect "t" "SELECT must_change_password = FALSE FROM users WHERE owner_slot = 1;"


expect "1" "SELECT count(*) FROM pg_extension WHERE extname = 'pg_trgm';"
expect "5" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('catalog_imports','card_sets','oracle_cards','card_printings','card_faces');"
expect "3" "SELECT count(*) FROM pg_constraint WHERE conname IN ('ck_catalog_imports_status','ck_catalog_imports_active_complete','ck_catalog_imports_nonnegative_counts');"
expect "1" "SELECT count(*) FROM pg_index AS index_meta JOIN pg_class AS index_relation ON index_relation.oid = index_meta.indexrelid JOIN pg_class AS table_relation ON table_relation.oid = index_meta.indrelid JOIN pg_namespace AS table_schema ON table_schema.oid = table_relation.relnamespace WHERE table_schema.nspname = 'public' AND table_relation.relname = 'catalog_imports' AND index_relation.relname = 'uq_catalog_imports_one_active_per_game' AND index_meta.indisunique AND index_meta.indnatts = 2 AND index_meta.indnkeyatts = 2 AND pg_get_indexdef(index_meta.indexrelid, 1, TRUE) = 'game' AND pg_get_indexdef(index_meta.indexrelid, 2, TRUE) = 'active' AND pg_get_expr(index_meta.indpred, index_meta.indrelid, TRUE) = 'active';"
expect "0" "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'catalog_imports' AND indexname = 'uq_catalog_imports_one_active';"
expect "0" "SELECT count(*) FROM pg_constraint WHERE conrelid = 'catalog_imports'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) LIKE '%source_bulk_id%';"
expect "5" "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'jsonb' AND ((table_name = 'oracle_cards' AND column_name = 'legalities') OR (table_name = 'card_printings' AND column_name IN ('finishes','games','colors','color_identity')));"
expect "5" "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('ix_oracle_cards_legalities_gin','ix_card_printings_finishes_gin','ix_card_printings_games_gin','ix_card_printings_colors_gin','ix_card_printings_color_identity_gin') AND indexdef LIKE '%USING gin%';"
expect "0" "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ix_card_faces_printing_order';"

expect "2" "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('ix_oracle_cards_type_line_trgm','ix_card_printings_collector_lower');"

writer_fifo="$(mktemp -u)"
mkfifo "${writer_fifo}"
docker exec --interactive \
  --env "PGPASSWORD=${database_password}" \
  "${database_container}" \
  psql --username "${database_user}" --dbname "${database_name}" \
  --set ON_ERROR_STOP=1 <"${writer_fifo}" >/dev/null &
writer_pid=$!
exec 7>"${writer_fifo}"
printf '%s\n' \
  "BEGIN;" \
  "INSERT INTO users (id, email, email_normalized, display_name, display_name_normalized, password_hash, role, owner_slot, is_active, must_change_password, password_changed_at, created_at, updated_at) VALUES ('22222222-2222-2222-2222-222222222222', 'member-3baccb5521d9@example.invalid', 'member-ccc38a8540e9@example.invalid', 'Catalog Admin', 'catalog admin', 'not-a-real-password-hash', 'ADMIN', NULL, TRUE, FALSE, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');" >&7

writer_locked=false
for _ in $(seq 1 100); do
  if [[ "$(query "SELECT count(*) FROM pg_locks WHERE relation = 'users'::regclass AND mode = 'RowExclusiveLock' AND granted AND pid <> pg_backend_pid();")" != "0" ]]; then
    writer_locked=true
    break
  fi
  sleep 0.1
done
if [[ "${writer_locked}" != true ]]; then
  echo "catalog migration smoke assertion failed: concurrent writer did not acquire users lock" >&2
  exit 1
fi

migration_log="$(mktemp)"
migration_status="$(mktemp)"
(
  if run_alembic downgrade 0002_catalog >"${migration_log}" 2>&1; then
    echo 0 >"${migration_status}"
  else
    echo $? >"${migration_status}"
  fi
) &
migration_pid=$!

downgrade_waiting=false
for _ in $(seq 1 200); do
  if [[ "$(query "SELECT count(*) FROM pg_locks WHERE relation = 'users'::regclass AND mode = 'AccessExclusiveLock' AND NOT granted;")" != "0" ]]; then
    downgrade_waiting=true
    break
  fi
  sleep 0.1
done
if [[ "${downgrade_waiting}" != true ]]; then
  echo "catalog migration smoke assertion failed: downgrade did not wait on concurrent writer" >&2
  exit 1
fi

printf '%s\n' "COMMIT;" "\\q" >&7
exec 7>&-
wait "${writer_pid}"
wait "${migration_pid}"

if [[ "$(cat "${migration_status}")" == "0" ]]; then
  cat "${migration_log}" >&2
  echo "catalog migration smoke assertion failed: concurrent administrator slipped between downgrade check and schema change" >&2
  exit 1
fi
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"
expect "3" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('collection_items','decks','deck_cards');"
expect "1" "SELECT count(*) FROM users WHERE role = 'ADMIN';"
query "DELETE FROM users WHERE role = 'ADMIN';"
query "UPDATE users SET must_change_password = TRUE WHERE owner_slot = 1;"
if run_alembic downgrade 0002_catalog; then
  echo "catalog migration smoke assertion failed: downgrade accepted forced-password state" >&2
  exit 1
fi
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"
expect "3" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('collection_items','decks','deck_cards');"
expect "t" "SELECT must_change_password FROM users WHERE owner_slot = 1;"
query "UPDATE users SET must_change_password = FALSE WHERE owner_slot = 1;"
run_alembic downgrade 0002_catalog
expect "0002_catalog" "SELECT version_num FROM alembic_version;"
expect "0" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('collection_items','decks','deck_cards');"
expect "1" "SELECT count(*) FROM users WHERE owner_slot = 1;"
run_alembic upgrade head
expect "t" "SELECT version_num = '0011_collection_value_history' FROM alembic_version;"
expect "t" "SELECT must_change_password = FALSE FROM users WHERE owner_slot = 1;"
run_alembic downgrade 0001_identity
expect "0" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('catalog_imports','card_sets','oracle_cards','card_printings','card_faces');"

run_alembic upgrade head
expect "5" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('catalog_imports','card_sets','oracle_cards','card_printings','card_faces');"
expect "5" "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('ix_oracle_cards_legalities_gin','ix_card_printings_finishes_gin','ix_card_printings_games_gin','ix_card_printings_colors_gin','ix_card_printings_color_identity_gin') AND indexdef LIKE '%USING gin%';"
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"
expect "3" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('collection_items','decks','deck_cards');"
query "INSERT INTO account_invitations (id, token_hash, created_by_user_id, expires_at, revoked_at, used_at, used_by_user_id, revision, created_at, updated_at) VALUES ('66666666-6666-6666-6666-666666666666', repeat('c', 64), '11111111-1111-1111-1111-111111111111', '2026-01-08T00:00:00Z', NULL, NULL, NULL, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
if run_alembic downgrade 0005_collection_imports; then
  echo "catalog migration smoke assertion failed: Phase 5B downgrade accepted an invitation" >&2
  exit 1
fi
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"
expect "1" "SELECT count(*) FROM account_invitations;"
query "DELETE FROM account_invitations WHERE id = '66666666-6666-6666-6666-666666666666';"
run_alembic downgrade 0005_collection_imports
expect "0005_collection_imports" "SELECT version_num FROM alembic_version;"
expect "0" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'account_invitations';"
run_alembic upgrade head
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"

query "INSERT INTO collection_import_previews (id, user_id, source_sha256, rows, summary, collection_digest, revision, expires_at, confirmed_at, created_at, updated_at) VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', repeat('a', 64), '[]'::jsonb, '{}'::jsonb, repeat('b', 64), 1, '2026-01-02T00:00:00Z', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
if run_alembic downgrade 0004_collections_decks; then
  echo "catalog migration smoke assertion failed: Phase 5A downgrade accepted an import preview" >&2
  exit 1
fi
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"
expect "1" "SELECT count(*) FROM collection_import_previews;"
query "DELETE FROM collection_import_previews WHERE id = '55555555-5555-5555-5555-555555555555';"
run_alembic downgrade 0004_collections_decks
expect "0004_collections_decks" "SELECT version_num FROM alembic_version;"
expect "0" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'collection_import_previews';"
run_alembic upgrade head
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"
query "INSERT INTO decks (id, user_id, name, name_normalized, format, description, revision, created_at, updated_at) VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Phase Four Smoke', 'phase four smoke', 'modern', NULL, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
if run_alembic downgrade 0003_admin_controls; then
  echo "catalog migration smoke assertion failed: Phase 4 downgrade accepted nonempty private data" >&2
  exit 1
fi
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"
query "DELETE FROM decks WHERE id = '33333333-3333-3333-3333-333333333333';"
run_alembic downgrade 0003_admin_controls
expect "0003_admin_controls" "SELECT version_num FROM alembic_version;"
expect "0" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('collection_items','decks','deck_cards');"
run_alembic upgrade head
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"
expect "3" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('collection_items','decks','deck_cards');"
query "INSERT INTO trading_accounts (id, user_id, status, active_strikes, revision, suspended_at, created_at, updated_at) VALUES ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'active', 0, 1, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
if run_alembic downgrade 0006_account_invitations; then
  echo "catalog migration smoke assertion failed: Phase 5D downgrade accepted trading data" >&2
  exit 1
fi
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"
expect "1" "SELECT count(*) FROM trading_accounts;"
query "DELETE FROM trading_accounts WHERE id = '77777777-7777-7777-7777-777777777777';"
run_alembic downgrade 0006_account_invitations
expect "0006_account_invitations" "SELECT version_num FROM alembic_version;"
expect "0" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('trading_accounts','trade_listings','want_listings','trade_reports','trade_strikes','trade_moderation_events');"
run_alembic upgrade head
expect "0011_collection_value_history" "SELECT version_num FROM alembic_version;"

expect "2" "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('ix_oracle_cards_type_line_trgm','ix_card_printings_collector_lower');"
echo "ephemeral-postgres-catalog-migration-smoke-ok"
