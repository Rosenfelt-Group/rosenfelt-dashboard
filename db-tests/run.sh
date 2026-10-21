#!/usr/bin/env bash
# Throwaway-Postgres harness for SQL migrations.
#   db-tests/run.sh [--refresh]
# 1. Starts postgres:17-alpine.  2. Stubs Supabase schemas/roles.
# 3. Loads a cached schema-only dump of crm/rooms/public from prod (READ-ONLY pg_dump). The cache is
#    refreshed automatically when a read-only fingerprint of prod's columns/functions differs from
#    the one stored with the dump (the cache age is always printed).
# 4. Applies every docs/migrations/2026-10-22_*.sql in filename order (idempotent).
# 5. Runs every db-tests/*.sql.  6. Removes the container.
# --refresh forces a new dump.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
REFRESH=0
for a in "$@"; do
  case "$a" in
    --refresh) REFRESH=1 ;;
    *) echo "usage: $0 [--refresh]" >&2; exit 2 ;;
  esac
done

CACHE="$HERE/.cache"
DUMP="$CACHE/schema.sql"
SIG="$CACHE/schema.sig"
mkdir -p "$CACHE"

for f in "$HOME/.pgpass" "$HOME/.pg_service.conf"; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
done
prod_pg() {
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -e PGSERVICEFILE=/pg/pg_service.conf -e PGPASSFILE=/pg/pgpass \
    -v "$HOME/.pg_service.conf:/pg/pg_service.conf:ro" -v "$HOME/.pgpass:/pg/pgpass:ro" \
    postgres:17-alpine "$@"
}

# Read-only fingerprint of prod's crm/rooms/public columns and function bodies, to detect a stale cache.
current_sig() {
  prod_pg psql "service=rosably" -X -tA -c "
    select md5(coalesce(string_agg(x, '|' order by x), '')) from (
      select 'c:' || table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as x
        from information_schema.columns where table_schema in ('crm','rooms','public')
      union all
      select 'f:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(pg_get_functiondef(p.oid))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('crm','rooms','public') and p.prokind in ('f','p')
    ) t"
}

if [ -s "$DUMP" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$DUMP") ))
  echo ">> cached schema dump age: $(( AGE / 3600 ))h $(( AGE % 3600 / 60 ))m"
  if [ "$REFRESH" = 0 ]; then
    NOW_SIG="$(current_sig 2>/dev/null || true)"
    if [ -z "$NOW_SIG" ]; then
      echo ">> WARNING: could not fingerprint prod; refreshing if older than 24h"
      [ "$AGE" -gt 86400 ] && REFRESH=1
    elif [ ! -s "$SIG" ] || [ "$NOW_SIG" != "$(cat "$SIG")" ]; then
      echo ">> cache is stale (prod schema fingerprint changed); refreshing"
      REFRESH=1
    fi
  fi
fi

if [ "$REFRESH" = 1 ] || [ ! -s "$DUMP" ]; then
  echo ">> dumping schema from service=rosably (read-only)"
  NEW_SIG="$(current_sig)"
  prod_pg pg_dump "service=rosably" --schema-only --no-owner --no-privileges \
      -n crm -n rooms -n public \
    | grep -vE '^(CREATE EXTENSION|COMMENT ON EXTENSION)' > "$DUMP.tmp"
  mv "$DUMP.tmp" "$DUMP"
  echo "$NEW_SIG" > "$SIG"
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

# Apply every 2026-10-22_*.sql migration in filename order (they are idempotent). The
# --no-privileges dump drops prod's REVOKEs/GRANTs; re-applying restores them.
shopt -s nullglob
MIGRATIONS=("$REPO"/docs/migrations/2026-10-22_*.sql)
[ "${#MIGRATIONS[@]}" -gt 0 ] || { echo "no docs/migrations/2026-10-22_*.sql found" >&2; exit 1; }
for m in "${MIGRATIONS[@]}"; do
  echo ">> applying migration $(basename "$m")"
  psqlc -v ON_ERROR_STOP=1 < "$m"
done

fail=0
for t in "$HERE"/*.sql; do
  echo ">> running $(basename "$t")"
  if ! psqlc -v ON_ERROR_STOP=1 < "$t"; then
    echo "FAIL: $(basename "$t")" >&2
    fail=1
  fi
done
[ "$fail" = 0 ] && echo "ALL DB TESTS PASSED" || exit 1
