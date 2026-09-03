#!/usr/bin/env bash
# Restore only into a disposable, network-isolated database before upgrading.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
umask 077
backup="${1:?Usage: verify-backup.sh ABSOLUTE_BACKUP_DIRECTORY}"
[[ "$backup" = /* ]] && validate_backup_directory "$backup" || {
  standalone_die "Backup layout or checksums are invalid."
  exit 1
}
expected="$(sed -n 's/^migration=//p' "$backup/manifest.txt")"
[[ "$expected" =~ ^[a-zA-Z0-9_]+$ ]] || { standalone_die "Invalid backup migration."; exit 1; }
require_docker
container="cardvault-upgrade-verify-$(date +%s)-$$"
created=0
cleanup() {
  if [[ "$created" = 1 ]]; then docker rm -fv "$container" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
# No host ports, no external network, no production volumes or credentials.
docker create --name "$container" --network none \
  -e POSTGRES_DB=wynterlabs_cards -e POSTGRES_USER=wynterlabs_cards \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17.6-alpine >/dev/null
created=1
docker start "$container" >/dev/null
ready=0
for attempt in $(seq 1 30); do
  if docker exec "$container" psql -U wynterlabs_cards -d wynterlabs_cards -Atqc 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" = 1 ]] || { standalone_die "Isolated restore database did not become ready."; exit 1; }
docker exec -i "$container" pg_restore --exit-on-error --no-owner --no-acl \
  -U wynterlabs_cards -d wynterlabs_cards < "$backup/database.dump"
actual="$(docker exec "$container" psql -v ON_ERROR_STOP=1 -U wynterlabs_cards \
  -d wynterlabs_cards -Atqc 'SELECT version_num FROM alembic_version')"
[[ "$actual" = "$expected" ]] || { standalone_die "Restored migration differs from the backup manifest."; exit 1; }
echo "Isolated pre-upgrade backup restore verified."
