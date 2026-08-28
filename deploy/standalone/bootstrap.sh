#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

umask 077
installer="$script_dir/install.sh"
apt_get=/usr/bin/apt-get
systemctl=/usr/bin/systemctl
curl_command=curl

if [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]]; then
  installer="${STANDALONE_BOOTSTRAP_INSTALLER:-$installer}"
  apt_get=apt-get
  systemctl=systemctl
  curl_command="${STANDALONE_BOOTSTRAP_CURL_COMMAND:-curl}"
else
  [[ "${EUID:-$(id -u)}" = 0 ]] || {
    standalone_die "Run the standalone bootstrap as root with sudo."
    exit 1
  }
fi

require_supported_host || exit 1
[[ -x "$installer" && ! -L "$installer" ]] || {
  standalone_die "The standalone installer is unavailable."
  exit 1
}

docker_missing=0
curl_missing=0
require_docker >/dev/null 2>&1 || docker_missing=1
command -v "$curl_command" >/dev/null 2>&1 || curl_missing=1

if [[ "$docker_missing" = 1 || "$curl_missing" = 1 ]]; then
  "$apt_get" update
  packages=()
  [[ "$docker_missing" = 0 ]] || packages+=(docker.io docker-compose-v2)
  [[ "$curl_missing" = 0 ]] || packages+=(curl ca-certificates)
  DEBIAN_FRONTEND=noninteractive "$apt_get" install -y --no-install-recommends "${packages[@]}"
fi

if [[ "$docker_missing" = 1 ]]; then
  "$systemctl" enable --now docker
fi

require_docker || {
  standalone_die "Docker Engine and Docker Compose v2 are not usable after host preparation."
  exit 1
}
command -v "$curl_command" >/dev/null 2>&1 || {
  standalone_die "curl is not usable after host preparation."
  exit 1
}

exec "$installer" "$@"
