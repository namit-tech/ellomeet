import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

/**
 * Passcode hashing.
 *
 * A room passcode is a shared secret, so it is stored the way any secret is:
 * salted and hashed, never plaintext, and never sent back to a client. scrypt
 * is in Node core (no dependency) and deliberately slow, which is what makes a
 * short numeric PIN survive an offline guess if the store ever leaks.
 *
 * Format `salt:hash`, both hex. Comparison is constant-time so a wrong passcode
 * cannot be narrowed by timing.
 */

const KEYLEN = 32;

export function hashPasscode(passcode) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(passcode), salt, KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPasscode(passcode, stored) {
  if (!stored) return true; // no passcode on this room → nothing to check
  if (typeof passcode !== "string" || !passcode) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(passcode, Buffer.from(saltHex, "hex"), KEYLEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
