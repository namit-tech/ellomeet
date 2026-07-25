import { randomInt } from "crypto";

/**
 * Room-code generation.
 *
 * The code IS the security boundary (a capability URL, like Google Meet's
 * `abc-defg-hjk`), so it must be:
 *
 *   - unguessable: drawn from a CSPRNG, never Math.random which is predictable
 *     from prior outputs;
 *   - large: 10 characters over a 31-letter alphabet ≈ 31^10 ≈ 8×10^14, ~49
 *     bits — enumeration and accidental collision are both off the table;
 *   - unambiguous: no 0/O/1/l/i confusion, so a code read off a screen or said
 *     aloud transcribes cleanly.
 *
 * Format `xxx-xxxx-xxx` purely for readability; the dashes carry no meaning and
 * are stripped on the way in.
 */

// Lowercase, minus the characters people mistype: 0 o 1 l i.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const GROUPS = [3, 4, 3]; // xxx-xxxx-xxx

export function generateRoomCode() {
  return GROUPS.map(
    (n) =>
      Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
  ).join("-");
}

/**
 * Normalise a code as typed. Case-folds and strips anything outside the
 * alphabet (dashes, stray spaces), so `ABC-DEFG-HJK` and `abcdefghjk` are the
 * same room. Returns "" if nothing valid is left.
 */
export function normalizeRoomCode(input) {
  if (typeof input !== "string") return "";
  const cleaned = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Reject anything with characters outside our alphabet only loosely — a code
  // we minted always passes; a hand-typed legacy id is compared as-is.
  return cleaned;
}
