#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"
umask 077

if [[ -n "${STANDALONE_TEST_ROOT:-}" ]]; then
  [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]] || { standalone_die "Test root requires explicit test mode."; exit 1; }
  install_root="$STANDALONE_TEST_ROOT"
else
  install_root=/opt/wynterlabs/cards-standalone
fi
install_root="$(realpath "$install_root")"
runtime_env="$install_root/runtime.env"
current="$install_root/current"
[[ -f "$install_root/install.json" && -f "$runtime_env" && -L "$current" ]] || {
  standalone_die "A completed standalone installation is required."
  exit 1
}
release_dir="$(realpath "$current")"
[[ "$release_dir" = "$install_root"/releases/* && -d "$release_dir" ]] || {
  standalone_die "The active release link is invalid."
  exit 1
}
if [[ -n "${STANDALONE_TEST_BACKUP_ROOT:-}" ]]; then
  [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]] || exit 1
  backup_root="$STANDALONE_TEST_BACKUP_ROOT"
else
  backup_root="$(sed -n 's/^CARDS_BACKUP_ROOT=//p' "$runtime_env")"
fi
[[ -n "$backup_root" && ! -L "$backup_root" ]] || { standalone_die "Invalid backup root."; exit 1; }
install -d -m 700 "$(dirname "$backup_root")" "$backup_root"
require_safe_directory "$backup_root" "$(dirname "$backup_root")"

exec 9>"$install_root/.backup.lock"
flock -n 9 || { standalone_die "A standalone backup is already running."; exit 75; }

if [[ "${STANDALONE_TEST_MODE:-0}" = 1 && -n "${STANDALONE_TIMESTAMP:-}" ]]; then
  timestamp="$STANDALONE_TIMESTAMP"
else
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
fi
[[ "$timestamp" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || { standalone_die "Invalid backup timestamp."; exit 1; }
working="$backup_root/.partial-$timestamp-$$"
destination="$backup_root/$timestamp"
[[ ! -e "$working" && ! -e "$destination" ]] || { standalone_die "Backup destination already exists."; exit 1; }
install -d -m 700 "$working"
cleanup_backup() {
  [[ ! -d "$working" ]] || rm -rf -- "$working"
}
trap cleanup_backup EXIT

export CARDS_RELEASE_DIR="$release_dir"
compose "$runtime_env" exec -T cards-db pg_dump -U wynterlabs_cards -d wynterlabs_cards \
  --format=custom > "$working/database.dump"
[[ -s "$working/database.dump" ]] || { standalone_die "Database backup is empty."; exit 1; }
tar -C "$release_dir" -czf "$working/source.tar.gz" .
tar -C "$install_root" -czf "$working/secrets.tar.gz" secrets
migration="$(compose "$runtime_env" exec -T cards-db psql -U wynterlabs_cards \
  -d wynterlabs_cards -Atc 'select version_num from alembic_version')"
version="$(tr -d '\r\n' < "$release_dir/VERSION")"
project="$(sed -n 's/^CARDS_PROJECT_NAME=//p' "$runtime_env")"
source_sha256="$(sha256sum "$working/source.tar.gz" | cut -d' ' -f1)"
cat > "$working/manifest.txt" <<EOF
created_utc=$timestamp
version=$version
source_sha256=$source_sha256
migration=$migration
project=$project
database=wynterlabs_cards
EOF
(
  cd "$working"
  sha256sum database.dump source.tar.gz secrets.tar.gz manifest.txt > SHA256SUMS
)
mv -- "$working" "$destination"
trap - EXIT

find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' \
  -mtime +30 -print -exec rm -rf -- {} +
echo "Standalone backup complete: $destination"
