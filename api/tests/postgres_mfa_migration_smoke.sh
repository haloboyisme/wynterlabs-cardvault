#!/usr/bin/env bash
set -euo pipefail

api_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="${$}-${RANDOM}"
network="wynterlabs-mfa-migration-${suffix}"
container="wynterlabs-mfa-migration-pg-${suffix}"
user="mfa_migration"
database="mfa_migration"
password="test-only-credential-29f83cb60850"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run -d --rm --name "$container" --network "$network" -e "POSTGRES_USER=$user" -e "POSTGRES_PASSWORD=$password" -e "POSTGRES_DB=$database" postgres:17.6-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$container" pg_isready -U "$user" -d "$database" >/dev/null 2>&1 && break; sleep 1; done
docker exec "$container" pg_isready -U "$user" -d "$database" >/dev/null
alembic() {
  docker run --rm --network "$network" -v "$api_root:/app" -w /app \
    -e "CARDS_DATABASE_URL=postgresql+asyncpg://${user}:${password}@${container}:5432/${database}" \
    -e CARDS_BOOTSTRAP_SECRET_FILE=/tmp/unused -e CARDS_SESSION_PEPPER_FILE=/tmp/unused \
    -e CARDS_MFA_ENCRYPTION_KEY_FILE=/tmp/mfa-test-key python:3.13-slim \
    sh -lc "dd if=/dev/zero of=/tmp/mfa-test-key bs=32 count=1 status=none && pip install -q -e . && alembic $*"
}
query() { docker exec -e "PGPASSWORD=$password" "$container" psql -U "$user" -d "$database" -Atc "$1"; }
alembic upgrade 0008_collection_manual_prices
query "INSERT INTO users (id,email,email_normalized,display_name,display_name_normalized,password_hash,role,owner_slot,is_active,must_change_password,password_changed_at,created_at,updated_at) VALUES ('11111111-1111-1111-1111-111111111111','member-b1c04c27f9e3@example.invalid','member-ae3eb8b16a01@example.invalid','Owner','owner','hash','OWNER',1,true,false,now(),now(),now());"
query "INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at,last_seen_at,client_ip,user_agent) VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',now(),now() + interval '1 hour',now(),'192.0.2.150','mfa migration smoke');"
alembic upgrade head
test "$(query "SELECT version_num FROM alembic_version")" = "0015_open_signup_role_authority"
test "$(query "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('mfa_credentials','mfa_login_challenges','mfa_recovery_codes','security_audit_events')")" = "4"
test "$(query "SELECT count(*) FROM users WHERE owner_slot = 1")" = "1"
test "$(query "SELECT count(*) FROM sessions WHERE id = '22222222-2222-2222-2222-222222222222'")" = "1"
test "$(query "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'")" = "1"
test "$(query "SELECT count(*) FROM pg_constraint WHERE conname = 'ck_site_branding_singleton'")" = "1"
alembic downgrade 0011_collection_value_history
test "$(query "SELECT version_num FROM alembic_version")" = "0011_collection_value_history"
test "$(query "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'")" = "0"
test "$(query "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('mfa_credentials','mfa_login_challenges','mfa_recovery_codes','security_audit_events')")" = "4"
alembic upgrade head
test "$(query "SELECT version_num FROM alembic_version")" = "0015_open_signup_role_authority"
test "$(query "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'")" = "1"
alembic downgrade 0008_collection_manual_prices
test "$(query "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('mfa_credentials','mfa_login_challenges','mfa_recovery_codes','security_audit_events')")" = "0"
test "$(query "SELECT count(*) FROM users WHERE owner_slot = 1")" = "1"
test "$(query "SELECT count(*) FROM sessions WHERE id = '22222222-2222-2222-2222-222222222222'")" = "1"
test "$(query "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'")" = "0"
alembic upgrade head
test "$(query "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('mfa_credentials','mfa_login_challenges','mfa_recovery_codes','security_audit_events')")" = "4"
test "$(query "SELECT version_num FROM alembic_version")" = "0015_open_signup_role_authority"
test "$(query "SELECT count(*) FROM information_schema.tables WHERE table_name = 'site_branding'")" = "1"
test "$(query "SELECT count(*) FROM sessions WHERE id = '22222222-2222-2222-2222-222222222222'")" = "1"
echo "ephemeral-postgres-mfa-migration-smoke-ok"
