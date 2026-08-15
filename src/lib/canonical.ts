/**
 * Canonical JSON: object keys sorted, no insignificant whitespace.
 *
 * Event ids are hashes of canonical JSON, so two runs that observe the same fact
 * must serialise it identically regardless of the order the fields happened to be
 * built in. Without this the log would append a "new" event on every crawl and
 * stop being a stream of deltas.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    out[key] = canonicalize(source[key]);
  }
  return out;
}
