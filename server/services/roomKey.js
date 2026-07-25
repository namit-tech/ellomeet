/**
 * Room keys and tenancy.
 *
 * A room's server-side identity is `<tenant>.<code>` — the tenant is embedded in
 * the key, so isolation is automatic: `acme.abc-defg-hjk` and
 * `globex.abc-defg-hjk` are different rooms in the store AND different rooms in
 * the SFU (the LiveKit room is named by this key), with no extra plumbing.
 *
 * The URL carries the two parts separately — `/t/<tenant>/room/<code>` — and the
 * client composes the key. A plain `/room/<code>` maps to the DEFAULT_TENANT, so
 * casual use needs no tenant at all.
 *
 * Separator is `.`: it never appears in a tenant slug (validated below) nor in a
 * code (lowercase letters, digits, and `-`), so splitting is unambiguous.
 */

export const DEFAULT_TENANT = "public";
const SEP = ".";

// Lowercase alphanumeric and dashes, 1–40 chars. No dots (the separator), no
// spaces, nothing that would need escaping in a URL or a LiveKit room name.
const TENANT_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidTenant(slug) {
  return typeof slug === "string" && TENANT_RE.test(slug);
}

/** Compose a room key. Falls back to the default tenant for a bare code. */
export function makeRoomKey(tenant, code) {
  const t = isValidTenant(tenant) ? tenant : DEFAULT_TENANT;
  return `${t}${SEP}${code}`;
}

/** Split a key back into { tenant, code }. Tolerant of a bare code. */
export function splitRoomKey(key) {
  const i = String(key).indexOf(SEP);
  if (i < 0) return { tenant: DEFAULT_TENANT, code: key };
  return { tenant: key.slice(0, i), code: key.slice(i + 1) };
}
