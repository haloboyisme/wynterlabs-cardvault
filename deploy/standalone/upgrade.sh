#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"
umask 077

if [[ -n "${STANDALONE_TEST_ROOT:-}" ]]; then
  [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]] || { standalone_die "Test root requires explicit test mode."; exit 1; }
  [[ -d "$STANDALONE_TEST_ROOT" && ! -L "$STANDALONE_TEST_ROOT" ]] || { standalone_die "Install root must not be a symlink."; exit 1; }
  install_root="$(realpath "$STANDALONE_TEST_ROOT")"
  source_root="${STANDALONE_SOURCE_ROOT:?test source root required}"
  backup_root="${STANDALONE_TEST_BACKUP_ROOT:?test backup root required}"
else
  install_root=/opt/wynterlabs/cards-standalone
  source_root="$repo_dir"
  backup_root=""
fi
[[ -f "$install_root/install.json" && -f "$install_root/runtime.env" && -L "$install_root/current" ]] || {
  standalone_die "A completed standalone installation is required."
  exit 1
}
[[ -d "$source_root" && ! -L "$source_root" && -f "$source_root/VERSION" ]] || {
  standalone_die "The upgrade source is invalid."
  exit 1
}
require_docker

exec 9>"$install_root/.upgrade.lock"
flock -n 9 || { standalone_die "A standalone upgrade is already running."; exit 75; }

old_release="$(realpath "$install_root/current")"
[[ "$old_release" = "$install_root"/releases/* ]] || { standalone_die "Invalid active release."; exit 1; }
old_version="$(tr -d '\r\n' < "$old_release/VERSION")"
new_version="$(tr -d '\r\n' < "$source_root/VERSION")"
semver='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
[[ "$old_version" =~ $semver && "$new_version" =~ $semver ]] || {
  standalone_die "Versions must be plain semantic versions."
  exit 1
}
version_is_newer() {
  local old="$1" new="$2" old_a old_b old_c new_a new_b new_c
  IFS=. read -r old_a old_b old_c <<<"$old"
  IFS=. read -r new_a new_b new_c <<<"$new"
  (( new_a > old_a )) ||
    { (( new_a == old_a && new_b > old_b )); } ||
    { (( new_a == old_a && new_b == old_b && new_c > old_c )); }
}
version_is_newer "$old_version" "$new_version" || {
  standalone_die "Upgrade VERSION must be newer than $old_version."
  exit 1
}

old_runtime="$install_root/runtime.env"
if [[ -z "$backup_root" ]]; then
  backup_root="$(sed -n 's/^CARDS_BACKUP_ROOT=//p' "$old_runtime")"
fi
export STANDALONE_TEST_BACKUP_ROOT="${STANDALONE_TEST_BACKUP_ROOT:-}"
backup_output="$("$old_release/deploy/standalone/backup.sh")"
latest="$(printf '%s\n' "$backup_output" | sed -n 's/^Standalone backup complete: //p' | tail -n 1)"
[[ "$(printf '%s\n' "$backup_output" | grep -c '^Standalone backup complete: ')" = 1 ]] || latest=""
[[ "$latest" = "$backup_root"/20??????T??????Z && -d "$latest" ]] || {
  standalone_die "Pre-upgrade backup was not created."
  exit 1
}
if [[ "${STANDALONE_TEST_MODE:-0}" = 1 && -n "${STANDALONE_RESTORE_VERIFIER:-}" ]]; then
  verifier="$STANDALONE_RESTORE_VERIFIER"
else
  verifier="$source_root/deploy/standalone/verify-backup.sh"
fi
CARDS_RESTORE_BACKUP_ROOT="$backup_root" bash "$verifier" "$latest"

releases="$install_root/releases"
ensure_safe_child_directory "$install_root" releases 700 || { standalone_die "Invalid releases directory."; exit 1; }
new_release="$releases/$new_version"
[[ ! -e "$new_release" ]] || { standalone_die "Release $new_version already exists."; exit 1; }
snapshot_release "$source_root" "$new_release"
new_runtime="$install_root/.runtime.env.$new_version.partial-$$"
sed \
  -e "s|^CARDS_API_IMAGE=.*|CARDS_API_IMAGE=wynterlabs-cards-api:$new_version|" \
  -e "s|^CARDS_WEB_IMAGE=.*|CARDS_WEB_IMAGE=wynterlabs-cards-web:$new_version|" \
  "$old_runtime" > "$new_runtime"
if ! grep -q '^CARDS_HTTPS_ORIGIN=' "$new_runtime"; then
  runtime_host="$(sed -n 's/^CARDS_HOST=//p' "$new_runtime")"
  runtime_https_port="$(sed -n 's/^CARDS_HTTPS_PORT=//p' "$new_runtime")"
  printf 'CARDS_HTTPS_ORIGIN=%s\n' "$(standalone_https_origin "$runtime_host" "$runtime_https_port")" >> "$new_runtime"
fi
chmod 600 "$new_runtime"

rollback() {
  export CARDS_RELEASE_DIR="$old_release"
  compose "$old_runtime" up -d --wait >/dev/null 2>&1 || \
    standalone_die "Upgrade failed and automatic application rollback also failed."
}
run_new_release() {
  export CARDS_RELEASE_DIR="$new_release"
  compose "$new_runtime" config --quiet || return
  compose "$new_runtime" build cards-api cards-web || return
  compose "$new_runtime" up -d --wait cards-db || return
  compose "$new_runtime" run --rm --no-deps cards-api alembic upgrade head || return
  compose "$new_runtime" up -d --wait || return
}
if ! run_new_release; then
  rollback
  rm -f -- "$new_runtime"
  standalone_die "Upgrade failed; the prior application release was restored."
  exit 1
fi

mv -f -- "$new_runtime" "$old_runtime"
replace_symlink_atomic "$new_release" "$install_root/current"
host="$(sed -n 's/^CARDS_HOST=//p' "$old_runtime")"
http_port="$(sed -n 's/^CARDS_HTTP_PORT=//p' "$old_runtime")"
https_port="$(sed -n 's/^CARDS_HTTPS_PORT=//p' "$old_runtime")"
project="$(sed -n 's/^CARDS_PROJECT_NAME=//p' "$old_runtime")"
db_volume="$(sed -n 's/^CARDS_DB_VOLUME=//p' "$old_runtime")"
cat <<EOF | write_atomic "$install_root/install.json" 600
{
  "version": "$new_version",
  "host": "$host",
  "http_port": $http_port,
  "https_port": $https_port,
  "project": "$project",
  "database_volume": "$db_volume"
}
EOF
echo "Standalone upgrade complete: $old_version -> $new_version"
