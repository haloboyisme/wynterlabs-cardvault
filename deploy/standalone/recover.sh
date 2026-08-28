#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"
umask 077

backup="" name="" host="" http_port="" https_port="" mfa_key=""
while (($#)); do
  case "$1" in
    --backup) backup="${2:-}"; shift 2 ;;
    --name) name="${2:-}"; shift 2 ;;
    --host) host="${2:-}"; shift 2 ;;
    --http-port) http_port="${2:-}"; shift 2 ;;
    --https-port) https_port="${2:-}"; shift 2 ;;
    --mfa-key) mfa_key="${2:-}"; shift 2 ;;
    *) standalone_die "Unknown argument: $1"; exit 2 ;;
  esac
done
[[ "$backup" = /* && "$mfa_key" = /* ]] || { standalone_die "Backup and MFA key paths must be absolute."; exit 2; }
[[ "$name" =~ ^[a-z0-9][a-z0-9-]{2,31}$ && "$name" != standalone ]] || {
  standalone_die "Recovery name must be a safe unique name and cannot be standalone."
  exit 2
}
validate_host "$host" || { standalone_die "Invalid recovery host."; exit 2; }
validate_port "$http_port" || { standalone_die "Invalid recovery HTTP port."; exit 2; }
validate_port "$https_port" || { standalone_die "Invalid recovery HTTPS port."; exit 2; }
[[ "$http_port" != "$https_port" ]] || { standalone_die "Recovery ports must differ."; exit 2; }

if [[ -n "${STANDALONE_TEST_ROOT:-}" ]]; then
  [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]] || { standalone_die "Test root requires explicit test mode."; exit 1; }
  [[ -d "$STANDALONE_TEST_ROOT" && ! -L "$STANDALONE_TEST_ROOT" ]] || { standalone_die "Recovery root must not be a symlink."; exit 1; }
  install_root="$(realpath "$STANDALONE_TEST_ROOT")"
else
  install_root=/opt/wynterlabs/cards-standalone
fi
active_runtime="$install_root/runtime.env"
[[ -f "$install_root/install.json" && -f "$active_runtime" ]] || {
  standalone_die "A completed active installation is required."
  exit 1
}
active_http="$(sed -n 's/^CARDS_HTTP_PORT=//p' "$active_runtime")"
active_https="$(sed -n 's/^CARDS_HTTPS_PORT=//p' "$active_runtime")"
active_project="$(sed -n 's/^CARDS_PROJECT_NAME=//p' "$active_runtime")"
project="wynterlabs-cards-$name"
[[ "$project" != "$active_project" && "$http_port" != "$active_http" && "$http_port" != "$active_https" \
  && "$https_port" != "$active_http" && "$https_port" != "$active_https" ]] || {
  standalone_die "Recovery must use a different project and alternate ports."
  exit 1
}
port_is_free "$http_port" || { standalone_die "Recovery HTTP port is in use."; exit 1; }
port_is_free "$https_port" || { standalone_die "Recovery HTTPS port is in use."; exit 1; }
require_docker

[[ -d "$backup" && ! -L "$backup" && "$(basename "$backup")" =~ ^20[0-9]{6}T[0-9]{6}Z$ ]] || {
  standalone_die "Backup must be a non-symlink timestamped directory."
  exit 1
}
backup="$(realpath "$backup")"
validate_backup_directory "$backup" || {
  standalone_die "Backup layout or checksums are invalid."
  exit 1
}
[[ -f "$mfa_key" && ! -L "$mfa_key" && "$(wc -c < "$mfa_key" | tr -d ' ')" = 32 ]] || {
  standalone_die "The separately escrowed MFA key must be an exact 32-byte regular file."
  exit 1
}
validate_restore_archive "$backup/source.tar.gz" source || {
  standalone_die "Backup source archive contains an unsafe entry or layout."
  exit 1
}
validate_restore_archive "$backup/secrets.tar.gz" secrets || {
  standalone_die "Backup secrets archive contains an unsafe entry or layout."
  exit 1
}

version="$(sed -n 's/^version=//p' "$backup/manifest.txt")"
migration="$(sed -n 's/^migration=//p' "$backup/manifest.txt")"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  standalone_die "Backup version is invalid."
  exit 1
}
case "$migration" in
  0002_catalog|0003_admin_controls|0004_collections_decks|0005_collection_imports|\
  0006_account_invitations|0007_private_trading|0008_collection_manual_prices|0009_privileged_mfa|0010_multi_game_catalog|0011_collection_value_history) ;;
  *) standalone_die "Unsupported backup migration: $migration"; exit 1 ;;
esac

recoveries="$install_root/recoveries"
ensure_safe_child_directory "$install_root" recoveries 700 || { standalone_die "Invalid recoveries directory."; exit 1; }
destination="$recoveries/$name"
partial="$recoveries/.partial-$name-$$"
[[ ! -e "$destination" && ! -L "$destination" && ! -e "$partial" && ! -L "$partial" ]] || {
  standalone_die "Recovery destination already exists."
  exit 1
}
ensure_safe_child_directory "$recoveries" ".partial-$name-$$" 700 || { standalone_die "Invalid recovery staging directory."; exit 1; }
staging=1
cleanup_staging() {
  if [[ "$staging" = 1 ]]; then
    safe_remove_child_tree "$recoveries" "$partial" >/dev/null 2>&1 || true
  fi
}
trap cleanup_staging EXIT
install -d -m 700 "$partial/releases" "$partial/escrow"
tar --no-same-owner --no-same-permissions -C "$partial" -xzf "$backup/secrets.tar.gz"
release="$partial/releases/$version"
install -d -m 700 "$release"
tar --no-same-owner --no-same-permissions -C "$release" -xzf "$backup/source.tar.gz"
if find "$partial" -type l -print -quit | grep -q .; then
  safe_remove_child_tree "$recoveries" "$partial" || true
  standalone_die "Backup archives contain a symbolic link."
  exit 1
fi
[[ -f "$release/VERSION" && "$(tr -d '\r\n' < "$release/VERSION")" = "$version" ]] || {
  safe_remove_child_tree "$recoveries" "$partial" || true
  standalone_die "Backup source version does not match its manifest."
  exit 1
}
cp "$mfa_key" "$partial/escrow/mfa_aesgcm_key"
api_secret_uid=1000
api_secret_gid=1000
if [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]]; then
  api_secret_uid="$(id -u)"
  api_secret_gid="$(id -g)"
fi
for api_secret in "$partial/secrets/db_password" "$partial/secrets/bootstrap_secret" \
  "$partial/secrets/session_pepper" "$partial/escrow/mfa_aesgcm_key"; do
  secure_secret_file_for_container "$api_secret" "$api_secret_uid" "$api_secret_gid" || {
    standalone_die "Cannot secure a recovered API secret for the non-root container user."
    exit 1
  }
done
install -d -m 755 "$partial/public"
runtime="$partial/runtime.env"
cat > "$runtime" <<EOF
CARDS_INSTALL_ROOT=$destination
CARDS_ESCROW_ROOT=$destination/escrow
CARDS_BACKUP_ROOT=$destination/backups
CARDS_HOST=$host
CARDS_HTTP_PORT=$http_port
CARDS_HTTPS_PORT=$https_port
CARDS_HTTPS_ORIGIN=$(standalone_https_origin "$host" "$https_port")
CARDS_PROJECT_NAME=$project
CARDS_DB_VOLUME=${project}_cards_db
CARDS_API_IMAGE=wynterlabs-cards-api:$version
CARDS_WEB_IMAGE=wynterlabs-cards-web:$version
EOF
chmod 600 "$runtime"
mv -- "$partial" "$destination"
staging=0
trap - EXIT
runtime="$destination/runtime.env"
release="$destination/releases/$version"
export CARDS_RELEASE_DIR="$release"
started=0
cleanup_recovery() {
  local status=$?
  if [[ "$started" = 1 ]]; then
    compose "$runtime" down >/dev/null 2>&1 || true
    echo "Recovery evidence preserved at: $destination" >&2
    echo "The isolated database volume remains available for diagnosis: ${project}_cards_db" >&2
    echo "After diagnosis, remove only this recovery project and its isolated volumes with:" >&2
    printf '  ' >&2
    printf '%q ' docker compose --project-name "$project" --env-file "$runtime" \
      -f "$release/deploy/standalone/compose.yaml" down --volumes >&2
    printf '\n' >&2
  fi
  return "$status"
}
trap cleanup_recovery EXIT

compose "$runtime" config --quiet
started=1
compose "$runtime" up -d --wait cards-db
compose "$runtime" exec -T cards-db pg_restore -U wynterlabs_cards -d wynterlabs_cards \
  < "$backup/database.dump"
compose "$runtime" run --rm --no-deps cards-api alembic upgrade head
compose "$runtime" up -d --wait
compose "$runtime" cp cards-proxy:/data/caddy/pki/authorities/local/root.crt \
  "$destination/public/wynterlabs-cards-root-ca.crt"
chmod 644 "$destination/public/wynterlabs-cards-root-ca.crt"
url="https://$host:$https_port"
wait_for_https "$url/api/health/ready" "$destination/public/wynterlabs-cards-root-ca.crt"
wait_for_https "$url/" "$destination/public/wynterlabs-cards-root-ca.crt"
[[ "$(compose "$runtime" port cards-proxy 80)" = *":$http_port" ]] || {
  standalone_die "Recovery HTTP listener does not match the isolated port."
  exit 1
}
[[ "$(compose "$runtime" port cards-proxy 443)" = *":$https_port" ]] || {
  standalone_die "Recovery HTTPS listener does not match the isolated port."
  exit 1
}
if service_has_published_port "$runtime" cards-api 8000 || \
  service_has_published_port "$runtime" cards-db 5432; then
  standalone_die "Recovery exposed an internal API or database listener."
  exit 1
fi
started=0
trap - EXIT

echo "Recovery is ready: $url"
echo "To stop this recovery project without deleting its volume:"
echo "docker compose --project-name $project --env-file $runtime -f $release/deploy/standalone/compose.yaml down"
