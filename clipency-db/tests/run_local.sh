#!/bin/sh
# Rebuilds a throwaway local database and runs migrations 035+ and their tests.
# Local Postgres only (never points at Supabase). Usage: sh tests/run_local.sh
set -e
cd "$(dirname "$0")/.."
export LC_ALL=en_US.UTF-8
PSQL="${PSQL:-/opt/homebrew/opt/postgresql@16/bin/psql} -h ${PGHOST:-/tmp/cxpg} -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists cx_test" -c "create database cx_test" >/dev/null
run() { $PSQL -d cx_test "$@"; }
run -c "create extension if not exists pgcrypto" >/dev/null
run -f tests/000_local_stub.sql >/dev/null 2>&1
SNAP="select 'col '||table_name||'.'||column_name||' default='||coalesce(column_default,'') from information_schema.columns where table_schema='public' and table_name in (select tablename from pg_tables where schemaname='public' and tablename = any(string_to_array(:'old', ',')))
 union all select 'con '||conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint where conrelid::regclass::text = any(select 'public.'||x from unnest(string_to_array(:'old', ',')) x) or conrelid::regclass::text = any(string_to_array(:'old', ','))
 union all select 'trg '||tgrelid::regclass||' '||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text = any(string_to_array(:'old', ','))
 union all select 'pol '||tablename||' '||policyname from pg_policies where tablename = any(string_to_array(:'old', ',')) and schemaname='public'
 union all select 'fn '||proname||' '||md5(pg_get_functiondef(oid)) from pg_proc where pronamespace='public'::regnamespace and proname = any(string_to_array(:'oldfn', ','))
 order by 1"
OLD=$(run -At -c "select string_agg(tablename, ',') from pg_tables where schemaname='public'")
OLDFN=$(run -At -c "select string_agg(proname, ',') from pg_proc where pronamespace='public'::regnamespace")
echo "$SNAP" | run -At -v old="$OLD" -v oldfn="$OLDFN" > /tmp/cxpg/before.txt
for m in 035_review_window_24h; do
  run -f $m.sql >/dev/null 2>&1 || { echo "MIGRATION FAILED: $m"; run -f $m.sql 2>&1 | grep -i error; exit 1; }
  run -f $m.sql >/dev/null 2>&1 || { echo "RE-RUN FAILED: $m"; exit 1; }
  echo "applied (twice): $m"
done
echo "$SNAP" | run -At -v old="$OLD" -v oldfn="$OLDFN" > /tmp/cxpg/after.txt
echo "--- changes to things that existed before (should be only the approved 24h review rule):"
diff /tmp/cxpg/before.txt /tmp/cxpg/after.txt | grep '^[<>]' || echo "(none)"
echo "---"
for t in; do
  run -f tests/${t}_test.sql 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^ ]* NOTICE:  //'
done
