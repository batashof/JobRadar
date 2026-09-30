# Runbook: production Postgres cutover from Neon to Supabase (ADR-019)

One-off. Everything that touches production runs in GitHub Actions (`DB (prod)` workflow) or in the Render / Supabase dashboards: the developer's network blocks outbound TCP 5432.

## 0. Preconditions

- This change (v1.21.2) is merged into `main`. `workflow_dispatch` workflows can only be started once the file is on the default branch. Render auto-deploys it, and nothing changes yet: without `DATABASE_CA_CERT` the API uses `DATABASE_URL` exactly as before.
- **Neon answers queries.** A compute suspended for exhausting its monthly CU-hours stays down until the quota resets at the start of the next month, and the copy reads from it. Everything up to step 5 can be done while Neon is down.
- Note the Render service's region (service page → region badge, e.g. *Oregon*).

## 1. Create the Supabase project

- Free organization → **New project**. Region: the one closest to the Render service (Oregon → `us-west-2`, Ohio → `us-east-2`, Virginia → `us-east-1`, Frankfurt → `eu-central-1`, Singapore → `ap-southeast-1`).
- Database password: use **Generate a password** and keep it to letters and digits. Anything else must be percent-encoded in the URL.
- If the form offers **Enable Data API**, untick it. Otherwise: **Integrations → Data API → Overview → Enable Data API** → off. `db:migrate:prod` also revokes the Data API roles' grants, but the switch is the first layer.

## 2. Collect what the secrets need

- **Connection string:** **Connect** (top bar) → **Session pooler** → URI. It looks like `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`; put the password in. Not the direct connection (`db.<ref>.supabase.co`, IPv6-only) and not the transaction pooler (port 6543).
- **CA certificate:** **Project Settings → Database → SSL Configuration → Download certificate**. The file is PEM text (`-----BEGIN CERTIFICATE-----` … `-----END CERTIFICATE-----`).
- **Neon URL:** the current `DATABASE_URL` on Render (or Neon console → Connect). A `-pooler` host is fine; the copy script switches to the direct host.

## 3. GitHub repository secrets

Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `DATABASE_URL_PROD` | Supabase session-pooler URL with the password |
| `DATABASE_CA_CERT_PROD` | Full content of the downloaded certificate, BEGIN/END lines included |
| `NEON_DATABASE_URL` | Neon URL (only for the copy) |

## 4. Check the connection (read-only)

**Actions → DB (prod) → Run workflow → task `check`.** It connects the way the API does (verified TLS) and writes nothing. On a fresh project it prints `Connected: PostgreSQL 17.x …` and `Tables in public: 0.`. A red run names the problem: `self-signed certificate…` means a wrong or missing CA, `password authentication failed` a wrong URL or password, `ENOTFOUND` a wrong host. This works while Neon is still down.

## 5. Copy the data

**Actions → DB (prod) → Run workflow → task `copy-from-neon`.** It:

1. applies the migrations to Supabase without seeding, and revokes the Data API roles' grants;
2. refuses to continue if any Supabase table already has rows;
3. prints Neon's size (warning above 450 MB of the 500 MB limit);
4. dumps Neon's data and restores it in one transaction;
5. requires every table's row count on Supabase to equal the dump's → `Copy verified: every table matches the dump.`

Run `check` again afterwards: it should show 25 tables and `Data API role anon can read/write 0 public table(s).`

Expected noise: pg_dump warns about "circular foreign-key constraints" on `vacancies` and `plan_blocks`. Those are self-references and restore fine.

A warning `Neon took writes while the copy ran` means the live API wrote to Neon after the snapshot (new vacancies, sessions, planner rows). Those rows are not on Supabase. Usually that is harmless: ingestion refetches, and a session can log in again. For a strict copy, suspend the Render service for the run.

If the run failed after the restore and a re-run says `Target already has rows`, empty Supabase in its **SQL Editor** and run the copy again:

```sql
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table public.%I cascade', t.tablename);
  end loop;
end $$;
```

## 6. Switch the API

Render → `jobradar-api` → **Environment**:

- `DATABASE_URL` → the Supabase session-pooler URL (same value as `DATABASE_URL_PROD`);
- add `DATABASE_CA_CERT` → the certificate PEM (multi-line, or with literal `\n`; both work).

Save, and Render redeploys. `/health` answers 200 even when the database is unreachable, so Render goes live with a wrong value too. Check step 7 right away, and roll back (below) if it does not come up green.

## 7. Verify

- `GET https://jobradar-api-ptvp.onrender.com/health` → `checks.db = "ok"`, `checks.dbHost` ends in `pooler.supabase.com`, `checks.dbCaConfigured = true`, `version = "1.21.2"`. When `db` is `unreachable`, `checks.dbError` says why (`self-signed certificate…` → CA missing, `password authentication failed` → URL/password, `ENOTFOUND` → host).
- The web app: feed, board and planner show the old data. Sessions were copied, so you stay logged in.
- The next digest slot arrives in Telegram.

## 8. Afterwards

- Keep Neon for about a week as a fallback. Rollback means restoring the old `DATABASE_URL` on Render and removing `DATABASE_CA_CERT`. Anything written to Supabase in the meantime stays behind.
- Then delete the Neon project and the `NEON_DATABASE_URL` secret.
- Supabase's Security Advisor flags "RLS disabled" on the `public` tables. That is expected under ADR-019 §5: the Data API is off and its roles hold no grants.
