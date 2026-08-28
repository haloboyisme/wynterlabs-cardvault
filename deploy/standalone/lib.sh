#!/usr/bin/env bash

standalone_die() {
  echo "$*" >&2
  return 1
}

standalone_file_mode() {
  local file="${1:?file required}" mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || true)"
  if [[ "$mode" =~ ^[0-7]{3,4}$ ]]; then
    printf '%s\n' "$mode"
    return 0
  fi
  mode="$(stat -c '%a' "$file" 2>/dev/null || true)"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  printf '%s\n' "$mode"
}

standalone_file_owner() {
  local file="${1:?file required}" owner
  owner="$(stat -f '%u' "$file" 2>/dev/null || true)"
  if [[ "$owner" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$owner"
    return 0
  fi
  owner="$(stat -c '%u' "$file" 2>/dev/null || true)"
  [[ "$owner" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$owner"
}

standalone_file_group() {
  local file="${1:?file required}" group
  group="$(stat -f '%g' "$file" 2>/dev/null || true)"
  if [[ "$group" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$group"
    return 0
  fi
  group="$(stat -c '%g' "$file" 2>/dev/null || true)"
  [[ "$group" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$group"
}

validate_port() {
  local value="${1:-}"
  [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] || return 1
  (( 10#$value <= 65535 ))
}

validate_host() {
  local value="${1:-}" label
  [[ -n "$value" && ${#value} -le 253 ]] || return 1
  [[ "$value" != *[[:space:]/\\\;\&\|\$\`\'\"]* && "$value" != *://* ]] || return 1
  if [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    local IFS=. octets=() octet
    read -r -a octets <<<"$value"
    for octet in "${octets[@]}"; do
      [[ "$octet" =~ ^(0|[1-9][0-9]{0,2})$ ]] || return 1
      (( 10#$octet <= 255 )) || return 1
    done
    return 0
  fi
  [[ "$value" == *.* || "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  local IFS=.
  read -r -a labels <<<"$value"
  for label in "${labels[@]}"; do
    [[ ${#label} -le 63 && "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

validate_ipv6_literal() {
  local value="${1:-}" normalized ipv4_tail left right group
  local group_count=0
  local -a groups=()
  [[ "$value" == *:* && "$value" =~ ^[0-9A-Fa-f:.]+$ ]] || return 1
  normalized="$value"

  if [[ "$normalized" == *.* ]]; then
    ipv4_tail="${normalized##*:}"
    [[ "$ipv4_tail" != "$normalized" && "$ipv4_tail" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
    validate_host "$ipv4_tail" || return 1
    normalized="${normalized%:*}:0:0"
  fi

  if [[ "$normalized" == *::* ]]; then
    [[ "${normalized#*::}" != *::* ]] || return 1
    left="${normalized%%::*}"
    right="${normalized#*::}"
    [[ -z "$left" || ( "$left" != :* && "$left" != *: ) ]] || return 1
    [[ -z "$right" || ( "$right" != :* && "$right" != *: ) ]] || return 1
    if [[ -n "$left" ]]; then
      IFS=: read -r -a groups <<<"$left"
      for group in "${groups[@]}"; do
        [[ "$group" =~ ^[0-9A-Fa-f]{1,4}$ ]] || return 1
        group_count=$((group_count + 1))
      done
    fi
    if [[ -n "$right" ]]; then
      IFS=: read -r -a groups <<<"$right"
      for group in "${groups[@]}"; do
        [[ "$group" =~ ^[0-9A-Fa-f]{1,4}$ ]] || return 1
        group_count=$((group_count + 1))
      done
    fi
    (( group_count < 8 ))
    return
  fi

  [[ "$normalized" != :* && "$normalized" != *: ]] || return 1
  IFS=: read -r -a groups <<<"$normalized"
  [[ ${#groups[@]} -eq 8 ]] || return 1
  for group in "${groups[@]}"; do
    [[ "$group" =~ ^[0-9A-Fa-f]{1,4}$ ]] || return 1
  done
}

is_unpublished_port_binding() {
  local binding="${1:-}" host
  [[ "$binding" = :0 ]] && return 0
  if [[ "$binding" =~ ^\[([^]]+)\]:0$ ]]; then
    host="${BASH_REMATCH[1]}"
    validate_ipv6_literal "$host"
    return
  fi
  if [[ "$binding" =~ ^([^:]+):0$ ]]; then
    host="${BASH_REMATCH[1]}"
    validate_host "$host"
    return
  fi
  return 1
}

standalone_https_origin() {
  local host="${1:?host required}" port="${2:?port required}"
  validate_host "$host" && validate_port "$port" || return 1
  if [[ "$port" = 443 ]]; then
    printf 'https://%s\n' "$host"
  else
    printf 'https://%s:%s\n' "$host" "$port"
  fi
}

require_trusted_os_release_file() {
  local os_file="${1:?OS release file required}"
  local canonical_file="${2:?canonical OS release file required}"
  local required_owner="${3:?required owner required}"
  [[ "$required_owner" =~ ^[0-9]+$ ]] || return 1
  if [[ -L "$os_file" ]]; then
    [[ "$(readlink "$os_file")" = ../usr/lib/os-release ]] || return 1
    [[ -f "$canonical_file" && ! -L "$canonical_file" ]] || return 1
    [[ "$(realpath "$os_file")" = "$(realpath "$canonical_file")" ]] || return 1
    [[ "$(standalone_file_owner "$canonical_file")" = "$required_owner" ]]
  else
    [[ -f "$os_file" ]] || return 1
    [[ "$(standalone_file_owner "$os_file")" = "$required_owner" ]]
  fi
}

require_supported_host() {
  local os_file machine id version
  if [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]]; then
    os_file="${OS_RELEASE_FILE:?OS_RELEASE_FILE is required in test mode}"
    machine="${MACHINE:?MACHINE is required in test mode}"
  else
    os_file=/etc/os-release
    machine="$(uname -m)"
  fi
  if [[ "${STANDALONE_TEST_MODE:-0}" = 1 ]]; then
    [[ -f "$os_file" && ! -L "$os_file" ]] || {
      standalone_die "Cannot verify the host operating system."
      return 1
    }
  else
    require_trusted_os_release_file "$os_file" /usr/lib/os-release 0 || {
      standalone_die "Cannot verify the host operating system."
      return 1
    }
  fi
  id="$(sed -n 's/^ID=//p' "$os_file" | tr -d '"' | head -n 1)"
  version="$(sed -n 's/^VERSION_ID=//p' "$os_file" | tr -d '"' | head -n 1)"
  [[ "$id" = ubuntu && "$version" = 26.04 && "$machine" = x86_64 ]] || \
    standalone_die "Standalone installation requires Ubuntu 26.04 LTS on amd64."
}

require_safe_directory() {
  local path="${1:?path required}" expected_parent="${2:?expected parent required}"
  [[ "$path" = /* && "$expected_parent" = /* ]] || return 1
  [[ -d "$path" && ! -L "$path" && -d "$expected_parent" && ! -L "$expected_parent" ]] || return 1
  [[ "$(realpath "$path")" = "$(realpath "$expected_parent")/$(basename "$path")" ]]
}

ensure_safe_child_directory() {
  local parent="${1:?parent required}" name="${2:?name required}" mode="${3:?mode required}" child
  [[ "$name" =~ ^\.?[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || return 1
  require_safe_directory "$parent" "$(dirname "$parent")" || return 1
  child="$parent/$name"
  [[ ! -L "$child" ]] || return 1
  if [[ -e "$child" ]]; then
    require_safe_directory "$child" "$parent" || return 1
    chmod "$mode" "$child"
  else
    install -d -m "$mode" "$child"
    require_safe_directory "$child" "$parent" || return 1
  fi
}

safe_remove_child_tree() {
  local parent="${1:?parent required}" child="${2:?child required}"
  require_safe_directory "$parent" "$(dirname "$parent")" || return 1
  [[ "$(dirname "$child")" = "$parent" && ! -L "$child" ]] || return 1
  [[ -e "$child" ]] || return 0
  require_safe_directory "$child" "$parent" || return 1
  rm -rf -- "$child"
}

write_atomic() {
  local destination="${1:?destination required}" mode="${2:?mode required}"
  local parent partial
  parent="$(dirname "$destination")"
  mkdir -p "$parent"
  [[ ! -L "$destination" ]] || return 1
  partial="$parent/.$(basename "$destination").partial-$$-$RANDOM"
  umask 077
  if ! cat > "$partial"; then
    rm -f -- "$partial"
    return 1
  fi
  chmod "$mode" "$partial"
  mv -f -- "$partial" "$destination"
}

replace_symlink_atomic() {
  local target="${1:?target required}" destination="${2:?destination required}"
  local partial
  [[ ! -e "$destination" || -L "$destination" ]] || return 1
  partial="$(dirname "$destination")/.$(basename "$destination").partial-$$-$RANDOM"
  ln -s "$target" "$partial"
  if mv --help 2>&1 | grep -q -- ' -T'; then
    mv -Tf -- "$partial" "$destination"
  else
    # BSD mv follows a destination symlink to a directory; this branch is used
    # only by the portable fake-host tests. Supported Ubuntu hosts use mv -T.
    rm -f -- "$destination"
    mv -f -- "$partial" "$destination"
  fi
}

ensure_secret_file() {
  local path="${1:?path required}" bytes="${2:?bytes required}" encoding="${3:?encoding required}"
  local parent partial
  [[ "$bytes" =~ ^[1-9][0-9]*$ ]] || return 1
  parent="$(dirname "$path")"
  mkdir -p "$parent"
  [[ -d "$parent" && ! -L "$parent" && ! -L "$path" ]] || return 1
  if [[ -e "$path" ]]; then
    [[ -f "$path" && -s "$path" ]] || return 1
    chmod 600 "$path"
    return 0
  fi
  partial="$parent/.$(basename "$path").partial-$$-$RANDOM"
  umask 077
  case "$encoding" in
    raw) head -c "$bytes" /dev/urandom > "$partial" ;;
    hex) head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n' > "$partial" ;;
    *) return 1 ;;
  esac
  chmod 600 "$partial"
  mv -- "$partial" "$path"
}

secure_secret_file_for_container() {
  local path="${1:?secret path required}" uid="${2:?UID required}" gid="${3:?GID required}"
  [[ "$uid" =~ ^[0-9]+$ && "$gid" =~ ^[0-9]+$ ]] || return 1
  [[ -f "$path" && ! -L "$path" ]] || return 1
  chown "$uid:$gid" "$path" || return 1
  chmod 600 "$path" || return 1
  [[ "$(standalone_file_owner "$path")" = "$uid" ]] || return 1
  [[ "$(standalone_file_group "$path")" = "$gid" ]] || return 1
  [[ "$(standalone_file_mode "$path")" = 600 ]]
}

snapshot_release() {
  local source="${1:?source required}" destination="${2:?destination required}"
  local parent partial
  [[ -d "$source" && ! -L "$source" && ! -e "$destination" ]] || return 1
  parent="$(dirname "$destination")"
  mkdir -p "$parent"
  partial="$parent/.$(basename "$destination").partial-$$-$RANDOM"
  mkdir -m 700 "$partial"
  if ! tar -C "$source" \
    --exclude='./.git' --exclude='./.worktrees' --exclude='./.runtime' \
    --exclude='./node_modules' --exclude='./dist' --exclude='./secrets' \
    --exclude='*/node_modules' --exclude='*/node_modules/*' \
    --exclude='*/dist' --exclude='*/dist/*' \
    --exclude='./backups' -cf - . | tar -C "$partial" -xf -; then
    rm -rf -- "$partial"
    return 1
  fi
  mv -- "$partial" "$destination"
}

compose() {
  local runtime_env="${1:?runtime env required}"
  shift
  local release_dir
  release_dir="${CARDS_RELEASE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  docker compose --project-name "$(sed -n 's/^CARDS_PROJECT_NAME=//p' "$runtime_env")" \
    --env-file "$runtime_env" -f "$release_dir/deploy/standalone/compose.yaml" "$@"
}

service_has_published_port() {
  local runtime_env="${1:?runtime env required}" service="${2:?service required}"
  local container_port="${3:?container port required}" bindings binding
  bindings="$(compose "$runtime_env" port "$service" "$container_port" 2>/dev/null)" || return 1
  while IFS= read -r binding || [[ -n "$binding" ]]; do
    binding="${binding#"${binding%%[![:space:]]*}"}"
    binding="${binding%"${binding##*[![:space:]]}"}"
    [[ -z "$binding" ]] && continue
    # Docker Compose can report an unpublished port as :0 (and equivalent
    # host:0 forms) while still exiting successfully. Any other non-empty
    # output is treated conservatively as a real published listener.
    is_unpublished_port_binding "$binding" && continue
    return 0
  done <<<"$bindings"
  return 1
}

wait_for_https() {
  local url="${1:?URL required}" ca_file="${2:?CA file required}"
  local attempt
  for attempt in $(seq 1 60); do
    curl --fail --silent --show-error --cacert "$ca_file" "$url" >/dev/null 2>&1 && return 0
    sleep 1
  done
  standalone_die "HTTPS readiness check failed for $url"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || standalone_die "Docker Engine is required."
  docker info >/dev/null 2>&1 || standalone_die "Docker Engine is not usable."
  docker compose version >/dev/null 2>&1 || standalone_die "Docker Compose v2 is required."
}

port_is_free() {
  local port="${1:?port required}"
  validate_port "$port" || return 1
  ! ss -H -lnt "sport = :$port" 2>/dev/null | grep -q .
}

validate_backup_directory() {
  local directory="${1:?backup directory required}" hash filename extra
  local database_count=0 source_count=0 secrets_count=0 manifest_count=0
  [[ -d "$directory" && ! -L "$directory" ]] || return 1
  for filename in database.dump source.tar.gz secrets.tar.gz manifest.txt SHA256SUMS; do
    [[ -f "$directory/$filename" && ! -L "$directory/$filename" ]] || return 1
  done
  while read -r hash filename extra; do
    [[ "$hash" =~ ^[[:xdigit:]]{64}$ && -z "$extra" ]] || return 1
    case "$filename" in
      database.dump) database_count=$((database_count + 1)) ;;
      source.tar.gz) source_count=$((source_count + 1)) ;;
      secrets.tar.gz) secrets_count=$((secrets_count + 1)) ;;
      manifest.txt) manifest_count=$((manifest_count + 1)) ;;
      *) return 1 ;;
    esac
  done < "$directory/SHA256SUMS"
  [[ "$database_count" = 1 && "$source_count" = 1 && "$secrets_count" = 1 && "$manifest_count" = 1 ]] || return 1
  (cd "$directory" && sha256sum --check SHA256SUMS >/dev/null)
}

validate_restore_archive() {
  local archive="${1:?archive required}" layout="${2:?layout required}" member type names listing
  local names_count=0 types_count=0 root_seen=0
  [[ -f "$archive" && ! -L "$archive" ]] || return 1
  names="$(tar -tzf "$archive")" || return 1
  listing="$(LC_ALL=C tar -tvzf "$archive")" || return 1
  while IFS= read -r member; do
    [[ -n "$member" && "$member" != /* && "$member" != *$'\n'* ]] || return 1
    [[ "$member" != '..' && "$member" != ../* && "$member" != */../* && "$member" != */.. ]] || return 1
    case "$layout:$member" in
      source:.|source:./) root_seen=1 ;;
      source:./*) ;;
      secrets:secrets|secrets:secrets/) root_seen=1 ;;
      secrets:secrets/*) ;;
      *) return 1 ;;
    esac
    names_count=$((names_count + 1))
  done <<< "$names"
  while IFS= read -r type; do
    [[ "$type" = - || "$type" = d ]] || return 1
    types_count=$((types_count + 1))
  done < <(printf '%s\n' "$listing" | sed -n 's/^\(.\).*$/\1/p')
  [[ "$root_seen" = 1 && "$names_count" = "$types_count" ]]
}
