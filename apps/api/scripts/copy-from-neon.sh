#!/usr/bin/env bash
# One-off copy of every row from the old Neon database into the new prod
# database (ADR-019). Run by the "DB (prod)" workflow (task: copy-from-neon)
# AFTER `db:migrate:prod --no-seed` has created the schema on the target.
#
# Data only: the schema comes from our own Drizzle migrations, so both sides
# are identical by construction and nothing Neon-specific leaks across. The
# restore is a single transaction — it either lands completely or not at all.
# Afterwards the target's per-table row counts must equal the dump's: the dump
# is one consistent snapshot, while live Neon may still be taking writes from
# the API, so Neon's own counts are only reported, not required to match.
#
# Env: NEON_DATABASE_URL (source), DATABASE_URL_PROD (target), optional
# PGSSLROOTCERT/PGSSLMODE (target TLS). Needs pg_dump/psql >= the Neon server.
set -euo pipefail

: "${NEON_DATABASE_URL:?NEON_DATABASE_URL is not set}"
: "${DATABASE_URL_PROD:?DATABASE_URL_PROD is not set}"

# pg_dump needs a real session; Neon's "-pooler" host is PgBouncer in
# transaction mode. The direct host is the same name without the suffix.
if [[ "$NEON_DATABASE_URL" == *-pooler.*neon.tech* ]]; then
  echo "Using Neon's direct host instead of its pooler for pg_dump."
  NEON_DATABASE_URL="${NEON_DATABASE_URL/-pooler./.}"
fi

# Supabase's free plan allows 500 MB for the whole database.
SIZE_LIMIT_MB=450

tables_sql="select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'"

# The target's TLS settings must not reach Neon, which uses a public CA.
neon() { env -u PGSSLROOTCERT -u PGSSLMODE "$@"; }

# psql against either side, keeping the target's TLS settings away from Neon.
q() {
  local url="$1"; shift
  if [ "$url" = "$NEON_DATABASE_URL" ]; then neon psql "$url" "$@"; else psql "$url" "$@"; fi
}

# Prints "table count" per public table of the given database, sorted.
row_counts() {
  local url="$1" table
  for table in $(q "$url" -Atc "$tables_sql"); do
    echo "$table $(q "$url" -Atc "select count(*) from public.\"$table\"")"
  done | LC_ALL=C sort
}

# Prints "table count" per COPY block of a plain-format dump, sorted. In COPY
# text format every row is exactly one line (newlines are escaped as \n).
dump_counts() {
  awk '
    /^COPY public\./ { t = $2; sub(/^public\./, "", t); gsub(/"/, "", t); n = 0; inside = 1; next }
    inside && $0 == "\\." { print t, n; inside = 0; next }
    inside { n++ }
  ' "$1" | LC_ALL=C sort
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

source_mb=$(q "$NEON_DATABASE_URL" -Atc "select round(sum(pg_total_relation_size(c.oid)) / 1048576.0)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'")
echo "Neon's public tables take ${source_mb} MB (with indexes)."
if [ "${source_mb:-0}" -gt "$SIZE_LIMIT_MB" ]; then
  echo "::warning::${source_mb} MB is close to Supabase's 500 MB free limit - a full database turns read-only"
fi

# Outside the checkout, so the dump can never be committed by accident.
dump="$(mktemp -d)/neon-data.sql"
trap 'rm -rf "$(dirname "$dump")"' EXIT

# pg_dump warns about "circular foreign-key constraints" on vacancies and
# plan_blocks. Those are self-references (canonical_vacancy_id,
# carried_from_block_id), checked at the end of each COPY statement, so a row
# may come before the row it points to; the restore does not need
# --disable-triggers (which Supabase would refuse anyway).
echo "Dumping Neon (data only, schema public)..."
neon pg_dump "$NEON_DATABASE_URL" --data-only --schema=public \
  --no-owner --no-privileges --file="$dump"

# pg_dump >= 17 opens with "SET transaction_timeout = 0", a setting that
# servers before 17 reject. Everything else in a data-only dump is portable.
target_version=$(psql "$DATABASE_URL_PROD" -Atc "show server_version_num")
if [ "$target_version" -lt 170000 ]; then
  sed -i '/^SET transaction_timeout = 0;$/d' "$dump"
fi

echo "Restoring into the target in one transaction..."
psql "$DATABASE_URL_PROD" -v ON_ERROR_STOP=1 --single-transaction --quiet -f "$dump"

echo "Refreshing planner statistics on the target..."
psql "$DATABASE_URL_PROD" -v ON_ERROR_STOP=1 --quiet -c "analyze"

echo "Comparing row counts with the dump..."
expected=$(dump_counts "$dump")
target_counts=$(row_counts "$DATABASE_URL_PROD")
echo "$target_counts"
if [ "$expected" != "$target_counts" ]; then
  diff <(echo "$expected") <(echo "$target_counts") || true
  echo "::error::Row counts on the target differ from the dump"
  exit 1
fi
echo "Copy verified: every table matches the dump."

neon_now=$(row_counts "$NEON_DATABASE_URL")
if [ "$neon_now" != "$expected" ]; then
  diff <(echo "$expected") <(echo "$neon_now") || true
  echo "::warning::Neon took writes while the copy ran (above: dump vs Neon now). Those rows are not on the target."
fi
