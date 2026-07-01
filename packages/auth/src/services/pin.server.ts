import { createHmac } from "crypto";

/**
 * MES keypad-login PIN crypto helpers.
 *
 * A worker's PIN is persisted on the per-company `employee` record as two derived
 * values (see migration `20260701163711_keypad-login-employee-pin.sql`):
 *
 *   - `pinHash`   — bcrypt (salted, non-deterministic) — VERIFIES an entered PIN.
 *   - `pinLookup` — the value produced by {@link hashPinLookup} below — a
 *                   deterministic keyed digest used to (a) enforce per-company PIN
 *                   uniqueness via the `employee_companyId_pinLookup_key` UNIQUE
 *                   index and (b) identify the employee at keypad login WITHOUT an
 *                   email. A salted bcrypt hash can do neither (equal PINs produce
 *                   different hashes), which is why this second column exists.
 *
 * The raw PIN is NEVER stored or transmitted — only these digests are.
 */

/** Minimum accepted PIN length. Console mode uses 4 digits. */
export const PIN_MIN_LENGTH = 4;
/** Maximum accepted PIN length — allows stronger PINs than the 4-digit console pad. */
export const PIN_MAX_LENGTH = 8;

const PIN_PATTERN = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);

/** True when `pin` is digits-only and within the accepted length range. */
export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/**
 * Deterministic, keyed lookup digest for a worker PIN, scoped to a company.
 *
 * HMAC-SHA256 over `${companyId}:${pin}` keyed by a server-side pepper. Because it
 * is deterministic (unlike bcrypt), it can back the per-company UNIQUE index on
 * `employee.pinLookup` and identify an employee at keypad login with no email.
 * Scoping by `companyId` means the same PIN at two companies yields two different
 * digests, so uniqueness is enforced per company, not globally.
 *
 * The pepper is a server-only secret (never the PIN itself); pass e.g.
 * `SESSION_SECRET`. Callers must reject an out-of-format PIN via {@link isValidPin}
 * before hashing.
 */
export function hashPinLookup(
  companyId: string,
  pin: string,
  pepper: string
): string {
  if (!companyId) throw new Error("companyId is required to hash a PIN lookup");
  if (!pepper) throw new Error("a pepper is required to hash a PIN lookup");
  return createHmac("sha256", pepper)
    .update(`${companyId}:${pin}`)
    .digest("hex");
}
