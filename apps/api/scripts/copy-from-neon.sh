#!/usr/bin/env bash
# One-off copy of every row from the old Neon database into the new prod
# database (ADR-019). Run by the "DB (prod)" workflow (task: copy-from-neon)
# AFTER `db:migrate:prod --no-seed` has created the schema on the target.
#
# Data only: the schema comes from our own Drizzle migrations, so both sides
# are identical by construction and nothing Neon-specific leaks across. The
# restore is a single transaction — it either lands completely or not at all —
# and the per-table row counts of both databases are compared afterwards.
#
# Env: NEON_DATABASE_URL (source), DATABASE_URL_PROD (target), optional
# PGSSLROOTCERT (target CA file). Needs pg_dump/psql >= the Neon server (18).
set -euo pipefail

: "${NEON_DATABASE_URL:?NEON_DATABASE_URL is not set}"
: "${DATABASE_URL_PROD:?DATABASE_URL_PROD is not set}"

tables_sql="select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"

# PGSSLROOTCERT is meant for the target only; Neon uses a public CA.
neon() { env -u PGSSLROOTCERT "$@"; }

# psql against either side, keeping the target's CA away from Neon.
q() {
  local url="$1"; shift
  if [ "$url" = "$NEON_DATABASE_URL" ]; then neon psql "$url" "$@"; else psql "$url" "$@"; fi
}

# Prints "table count" per public table of the given database.
row_counts() {
  local url="$1" table
  for table in $(q "$url" -Atc "$tables_sql"); do
    echo "$table $(q "$url" -Atc "select count(*) from public.\"$table\"")"
  done
}

echo "Checking the target is empty..."
target_before=$(row_counts "$DATABASE_URL_PROD")
if [ -z "$target_before" ]; then
  echo "::error::No tables on the target - run db:migrate:prod --no-seed first"
  exit 1
fi
if echo "$target_before" | awk '$2 != 0 { found = 1 } END { exit !found }'; then
  echo "$target_before" | awk '$2 != 0'
  echo "::error::Target already has rows - refusing to copy over them"
  exit 1
fi

echo "Dumping Neon (data only, schema public)..."
neon pg_dump "$NEON_DATABASE_URL" --data-only --schema=public \
  --no-owner --no-privileges --file=neon-data.sql

echo "Restoring into the target in one transaction..."
psql "$DATABASE_URL_PROD" -v ON_ERROR_STOP=1 --single-transaction --quiet -f neon-data.sql

echo "Comparing row counts..."
source_counts=$(row_counts "$NEON_DATABASE_URL")
target_counts=$(row_counts "$DATABASE_URL_PROD")
echo "$target_counts"
if [ "$source_counts" != "$target_counts" ]; then
  diff <(echo "$source_counts") <(echo "$target_counts") || true
  echo "::error::Row counts differ between Neon and the target"
  exit 1
fi
echo "Copy verified: every table matches."
