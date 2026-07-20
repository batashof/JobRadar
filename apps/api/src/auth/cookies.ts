/** Minimal cookie-header parser — avoids pulling in cookie-parser for one read site. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return out;
}
