#!/usr/bin/env bash
set -euo pipefail
if ! command -v docker >/dev/null; then exit 0; fi
name="wynterlabs-lock-smoke-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=cards_lock postgres:17-alpine >/dev/null
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
for _ in $(seq 1 30); do docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec -d "$name" psql -U postgres -d cards_lock -v ON_ERROR_STOP=1 -c "SELECT pg_advisory_lock(24568518643229779); SELECT pg_sleep(5);" >/dev/null
sleep 1
test "$(docker exec "$name" psql -U postgres -d cards_lock -Atc "SELECT pg_try_advisory_lock(24568518643229779);")" = "f"
sleep 5
test "$(docker exec "$name" psql -U postgres -d cards_lock -Atc "SELECT pg_try_advisory_lock(24568518643229779);")" = "t"
