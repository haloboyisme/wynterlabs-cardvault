#!/usr/bin/env bash
# Opt-in integration check; run ONLY in a disposable clone, never production.
set -euo pipefail
[[ "${CARDVAULT_DISPOSABLE_UPGRADE:-}" = YES ]] || { echo 'Disposable test opt-in required.' >&2; exit 2; }
scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$scripts/lib.sh"
root=/opt/wynterlabs/cards-standalone
runtime="$root/runtime.env"
export CARDS_RELEASE_DIR="$(realpath "$root/current")"
counts() {
  compose "$runtime" exec -T cards-db psql -v ON_ERROR_STOP=1 -U wynterlabs_cards \
    -d wynterlabs_cards -Atqc 'SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM collection_items)'
}
before="$(counts)"
target="$(tr -d '\r\n' < "$scripts/../../VERSION")"
bash "$scripts/upgrade.sh"
export CARDS_RELEASE_DIR="$(realpath "$root/current")"
[[ "$(tr -d '\r\n' < "$CARDS_RELEASE_DIR/VERSION")" = "$target" ]]
[[ "$(counts)" = "$before" ]]
compose "$runtime" exec -T cards-api python -c "import urllib.request; assert urllib.request.urlopen('http://127.0.0.1:8000/api/health/ready').status == 200"
echo 'PASS upgrade: target activated, user/card-row counts unchanged, API ready.'
