import type { PoolConfig } from 'pg';

/** Query parameters that describe TLS; dropped when an explicit CA takes over. */
const SSL_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];

/**
 * Builds the node-postgres config for a connection string (ADR-019).
 *
 * Supabase signs its server certificates with its own root CA, which Node does
 * not trust. node-postgres treats `sslmode=require` as `verify-full`, so a
 * plain Supabase URL fails with "self-signed certificate in certificate chain".
 * Passing the CA (PEM text, e.g. from the `DATABASE_CA_CERT` env var) keeps
 * full verification instead of switching it off.
 *
 * pg lets values parsed from the connection string override the `ssl` object
 * (connection-parameters.js merges the parsed URL last), so any TLS parameters
 * in the URL are removed when a CA is given — otherwise `sslmode=require`
 * would silently replace it with an empty `ssl: {}`.
 *
 * Without a CA the URL is passed through untouched: local Docker Postgres and
 * hosts with a publicly trusted certificate keep working as before.
 */
export function buildPoolConfig(connectionString: string | undefined, caCert?: string): PoolConfig {
  const ca = caCert?.trim();
  if (!connectionString || !ca) return { connectionString };

  const url = new URL(connectionString);
  for (const param of SSL_PARAMS) url.searchParams.delete(param);

  return {
    connectionString: url.toString(),
    // Env dashboards often store a multi-line PEM with literal "\n".
    ssl: { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true },
  };
}
