#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

umask 077
host=""
http_port=80
https_port=443
while (($#)); do
  case "$1" in
    --host) host="${2:-}"; shift 2 ;;
    --http-port) http_port="${2:-}"; shift 2 ;;
    --https-port) https_port="${2:-}"; shift 2 ;;
    *) standalone_die "Unknown argument: $1"; exit 2 ;;
  esac
done

validate_host "$host" || { standalone_die "--host must be one IPv4 address or DNS hostname."; exit 2; }
validate_port "$http_port" || { standalone_die "Invalid HTTP port."; exit 2; }
validate_port "$https_port" || { standalone_die "Invalid HTTPS port."; exit 2; }
[[ "$http_port" != "$https_port" ]] || { standalone_die "HTTP and HTTPS ports must differ."; exit 2; }
require_supported_host
require_docker
command -v curl >/dev/null 2>&1 || {
  standalone_die "curl is required for the HTTPS readiness check."
  exit 1
}
port_is_free "$http_port" || { standalone_die "HTTP port $http_port is already in use."; exit 1; }
port_is_free "$https_port" || { standalone_die "HTTPS port $https_port is already in use."; exit 1; }

version="$(tr -d '\r\n' < "$repo_dir/VERSION")"
[[ "$version" = 2.5.2 ]] || { standalone_die "This installer requires VERSION 2.5.2."; exit 1; }

if [[ -n "${STANDALONE_TEST_ROOT:-}" ]]; then
  [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]] || { standalone_die "Test roots require explicit test mode."; exit 1; }
  install_root="$STANDALONE_TEST_ROOT"
  escrow_root="${STANDALONE_TEST_ESCROW_ROOT:?test escrow root required}"
  backup_root="${STANDALONE_TEST_BACKUP_ROOT:?test backup root required}"
else
  install_root=/opt/wynterlabs/cards-standalone
  escrow_root=/opt/wynterlabs/cards-standalone-escrow
  backup_root=/opt/wynterlabs/backups/cards-standalone
fi

for guarded in "$install_root" "$escrow_root" "$backup_root"; do
  [[ ! -L "$guarded" ]] || { standalone_die "Refusing symlinked root: $guarded"; exit 1; }
done
install -d -m 700 "$(dirname "$install_root")" "$(dirname "$escrow_root")" "$(dirname "$backup_root")"
install -d -m 700 "$install_root" "$escrow_root" "$backup_root"
require_safe_directory "$install_root" "$(dirname "$install_root")"
require_safe_directory "$escrow_root" "$(dirname "$escrow_root")"
require_safe_directory "$backup_root" "$(dirname "$backup_root")"

exec 9>"$install_root/.install.lock"
flock -n 9 || { standalone_die "Standalone installation is already running."; exit 75; }
[[ ! -e "$install_root/install.json" ]] || {
  standalone_die "Standalone Cards is already installed. Use upgrade.sh."
  exit 1
}

secrets="$install_root/secrets"
public="$install_root/public"
releases="$install_root/releases"
ensure_safe_child_directory "$install_root" secrets 700 || { standalone_die "Invalid secrets directory."; exit 1; }
ensure_safe_child_directory "$install_root" releases 700 || { standalone_die "Invalid releases directory."; exit 1; }
ensure_safe_child_directory "$install_root" public 755 || { standalone_die "Invalid public directory."; exit 1; }
ensure_secret_file "$secrets/db_password" 32 hex
ensure_secret_file "$secrets/bootstrap_secret" 32 hex
ensure_secret_file "$secrets/session_pepper" 48 hex
ensure_secret_file "$escrow_root/mfa_aesgcm_key" 32 raw
api_secret_uid=1000
api_secret_gid=1000
if [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]]; then
  api_secret_uid="$(id -u)"
  api_secret_gid="$(id -g)"
fi
for api_secret in "$secrets/db_password" "$secrets/bootstrap_secret" \
  "$secrets/session_pepper" "$escrow_root/mfa_aesgcm_key"; do
  secure_secret_file_for_container "$api_secret" "$api_secret_uid" "$api_secret_gid" || {
    standalone_die "Cannot secure an API secret for the non-root container user."
    exit 1
  }
done

release_dir="$releases/$version"
if [[ -e "$release_dir" ]]; then
  safe_remove_child_tree "$releases" "$release_dir" || { standalone_die "Invalid incomplete release path."; exit 1; }
fi
snapshot_release "$repo_dir" "$release_dir"

project_name=wynterlabs-cards-standalone
db_volume=wynterlabs-cards-standalone_cards_db
api_image="wynterlabs-cards-api:$version"
web_image="wynterlabs-cards-web:$version"
runtime_env="$install_root/runtime.env"
cat <<EOF | write_atomic "$runtime_env" 600
CARDS_INSTALL_ROOT=$install_root
CARDS_ESCROW_ROOT=$escrow_root
CARDS_BACKUP_ROOT=$backup_root
CARDS_HOST=$host
CARDS_HTTP_PORT=$http_port
CARDS_HTTPS_PORT=$https_port
CARDS_HTTPS_ORIGIN=$(standalone_https_origin "$host" "$https_port")
CARDS_PROJECT_NAME=$project_name
CARDS_DB_VOLUME=$db_volume
CARDS_API_IMAGE=$api_image
CARDS_WEB_IMAGE=$web_image
EOF

export CARDS_RELEASE_DIR="$release_dir"
started=0
cleanup_install() {
  if [[ "$started" = 1 ]]; then
    compose "$runtime_env" down >/dev/null 2>&1 || true
  fi
}
trap cleanup_install EXIT

compose "$runtime_env" config --quiet
compose "$runtime_env" build cards-api cards-web
started=1
compose "$runtime_env" up -d --wait cards-db
compose "$runtime_env" run --rm --no-deps cards-api alembic upgrade head
compose "$runtime_env" up -d --wait
compose "$runtime_env" cp cards-proxy:/data/caddy/pki/authorities/local/root.crt \
  "$public/wynterlabs-cards-root-ca.crt"
chmod 644 "$public/wynterlabs-cards-root-ca.crt"

https_url="https://$host"
http_url="http://$host"
[[ "$https_port" = 443 ]] || https_url="$https_url:$https_port"
[[ "$http_port" = 80 ]] || http_url="$http_url:$http_port"
wait_for_https "$https_url/api/health/ready" "$public/wynterlabs-cards-root-ca.crt"

replace_symlink_atomic "$release_dir" "$install_root/current"
cat <<EOF | write_atomic "$install_root/install.json" 600
{
  "version": "$version",
  "host": "$host",
  "http_port": $http_port,
  "https_port": $https_port,
  "project": "$project_name",
  "database_volume": "$db_volume"
}
EOF
started=0
trap - EXIT

echo "WynterLabs Cards is ready: $https_url/setup"
echo "Trust this CA certificate: $public/wynterlabs-cards-root-ca.crt"
echo "CA download: $http_url/wynterlabs-cards-root-ca.crt"
echo "Read the one-time bootstrap secret locally from: $secrets/bootstrap_secret"
echo "Separately escrow the MFA key before enrollment: $escrow_root/mfa_aesgcm_key"
echo "Optional Google sign-in: after owner setup, open $https_url/admin → Google sign-in setup."
echo "Google is disabled by default. Use your own web client and an HTTPS hostname; never share its secret."
