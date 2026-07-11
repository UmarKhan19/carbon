import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from "node:crypto";

/**
 * Credential issuance for the QuickBooks Web Connector transport.
 *
 * The Web Connector authenticates with a username/password pair the user
 * pastes into QBWC exactly once (the .qwc file carries the username; the
 * password is typed at install time). Carbon stores only a scrypt hash —
 * the plaintext is shown once at generation and never persisted (the
 * `webConnector` credentials variant in core/models.ts stores
 * `{ type, username, passwordHash, ownerId, fileId, qbxmlVersion }` on
 * `companyIntegration.metadata.credentials`).
 */

/**
 * Identifies the Carbon application to QuickBooks across ALL companies —
 * QuickBooks keys the application's access grant (the "Application
 * Certificate" the admin approves on first connect) to this OwnerID.
 * Generated once (`uuidgen`) and hardcoded; it MUST NEVER CHANGE or every
 * connected company file would demand re-authorization as a brand-new
 * application.
 */
export const CARBON_QBWC_OWNER_ID = "C1885F59-B650-49EE-93B7-CDDC31482121";

/** scrypt parameters (N=16384, r=8, p=1 — interactive-login strength). */
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;

export interface ConnectionCredentials {
  /** QBWC login name; embeds the company id for authenticate() routing. */
  username: string;
  /**
   * Plaintext password — returned for one-time display only. Persist
   * `hashPassword(password)`, never the plaintext.
   */
  password: string;
  /** The fixed Carbon application GUID (CARBON_QBWC_OWNER_ID). */
  ownerId: string;
  /**
   * Per-connection GUID written into the .qwc file. QuickBooks stamps it
   * into the company file on first connect, pairing that file to this
   * connection — regeneration must preserve it (see
   * rotateConnectionPassword).
   */
  fileId: string;
}

/**
 * Issue a fresh credential set for a company's Web Connector connection.
 * The username embeds the companyId so authenticate() can resolve the
 * integration row from the login name alone.
 */
export function generateConnectionCredentials(
  companyId: string
): ConnectionCredentials {
  return {
    username: `carbon-${companyId}`,
    password: randomBytes(24).toString("base64url"),
    ownerId: CARBON_QBWC_OWNER_ID,
    fileId: randomUUID().toUpperCase()
  };
}

/**
 * Rotate the password of an existing connection. Everything else is
 * preserved — especially `fileId`: QuickBooks stamped it into the company
 * file on first connect, and changing it breaks the pairing (QB treats the
 * .qwc as a different connection). The customer only has to re-enter the
 * new password in QBWC; the installed .qwc stays valid.
 */
export function rotateConnectionPassword(existing: {
  username: string;
  ownerId: string;
  fileId?: string;
}): ConnectionCredentials {
  return {
    username: existing.username,
    password: randomBytes(24).toString("base64url"),
    ownerId: existing.ownerId,
    // A missing fileId means QB never connected — safe to mint one.
    fileId: existing.fileId ?? randomUUID().toUpperCase()
  };
}

/**
 * Hash a QBWC password with scrypt. Stored format:
 * `scrypt$<saltBase64>$<hashBase64>` (16-byte random salt, 32-byte key).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION
  });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Verify a QBWC login password against the stored `scrypt$salt$hash`
 * string. Constant-time on the hash comparison (timingSafeEqual over
 * equal-length buffers). Returns false — never throws — on a malformed or
 * tampered stored value, so authenticate() can treat every failure as
 * "invalid user" (`nvu`).
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;

  const [scheme, saltB64, hashB64] = parts;
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (
    salt.length !== SCRYPT_SALT_LENGTH ||
    expected.length !== SCRYPT_KEY_LENGTH
  ) {
    return false;
  }

  const actual = scryptSync(password, salt, expected.length, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION
  });

  return timingSafeEqual(actual, expected);
}
