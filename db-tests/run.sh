#!/usr/bin/env bash
# Throwaway-Postgres harness for SQL migrations.
#   db-tests/run.sh <migration.sql> [--refresh]
# 1. Starts postgres:17-alpine.  2. Stubs Supabase schemas/roles.
# 3. Loads a cached schema-only dump of crm/rooms/public from prod (READ-ONLY pg_dump).
# 4. Applies the migration.  5. Runs every db-tests/*.sql.  6. Removes the container.
# --refresh re-takes the dump from service=rosably; otherwise db-tests/.cache/schema.sql is reused.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION=""
REFRESH=0
for a in "$@"; do
  case "$a" in
    --refresh) REFRESH=1 ;;
    *) MIGRATION="$a" ;;
  esac
done
[ -n "$MIGRATION" ] && [ -f "$MIGRATION" ] || { echo "usage: $0 <migration.sql> [--refresh]" >&2; exit 2; }
MIGRATION="$(cd "$(dirname "$MIGRATION")" && pwd)/$(basename "$MIGRATION")"

CACHE="$HERE/.cache"
DUMP="$CACHE/schema.sql"
mkdir -p "$CACHE"

if [ "$REFRESH" = 1 ] || [ ! -s "$DUMP" ]; then
  echo ">> dumping schema from service=rosably (read-only)"
  for f in "$HOME/.pgpass" "$HOME/.pg_service.conf"; do
    [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
  done
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -e PGSERVICEFILE=/pg/pg_service.conf -e PGPASSFILE=/pg/pgpass \
    -v "$HOME/.pg_service.conf:/pg/pg_service.conf:ro" -v "$HOME/.pgpass:/pg/pgpass:ro" \
    postgres:17-alpine pg_dump "service=rosably" --schema-only --no-owner --no-privileges \
      -n crm -n rooms -n public \
    | grep -vE '^(CREATE EXTENSION|COMMENT ON EXTENSION)' > "$DUMP.tmp"
  mv "$DUMP.tmp" "$DUMP"
fi

NAME="dbtest-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo ">> starting $NAME"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test postgres:17-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 1
done
# the image restarts once during init; wait until it is stably ready
sleep 2
docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null

psqlc() { docker exec -i "$NAME" psql -U postgres -X -q "$@"; }

echo ">> stubbing Supabase schemas/roles"
psqlc -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','supabase_admin','authenticator'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS graphql;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS realtime;
SQL

echo ">> loading schema dump (errors from unrelated objects are tolerated)"
psqlc < "$DUMP" > "$CACHE/load.log" 2>&1 || true
echo "   load errors: $(grep -c 'ERROR' "$CACHE/load.log" || true) (see db-tests/.cache/load.log)"
docker exec "$NAME" psql -U postgres -X -tA -c "select to_regclass('crm.leads') is not null and to_regclass('crm.lead_activities') is not null" | grep -qx t \
  || { echo "FATAL: crm tables missing after load" >&2; exit 1; }

echo ">> applying migration $(basename "$MIGRATION")"
psqlc -v ON_ERROR_STOP=1 < "$MIGRATION"

fail=0
for t in "$HERE"/*.sql; do
  echo ">> running $(basename "$t")"
  if ! psqlc -v ON_ERROR_STOP=1 < "$t"; then
    echo "FAIL: $(basename "$t")" >&2
    fail=1
  fi
done
[ "$fail" = 0 ] && echo "ALL DB TESTS PASSED" || exit 1
