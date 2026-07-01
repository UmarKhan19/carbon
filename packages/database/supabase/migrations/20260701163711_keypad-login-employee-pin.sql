-- Keypad Login (MES): secure per-employee PIN.
--
-- A worker's PIN is NEVER stored in plaintext. It is persisted as two derived
-- values on the "employee" record (scoped per company — "user" has no
-- companyId, and a worker may hold different PINs at different companies):
--
--   "pinHash"   — slow, salted one-way hash (bcrypt) used to VERIFY an entered
--                 PIN. This is the authoritative secret; it is deliberately
--                 non-deterministic (unique salt per hash) so it cannot be
--                 rainbow-tabled.
--   "pinLookup" — deterministic keyed hash (HMAC-SHA256 of companyId + PIN with
--                 a server-side pepper) used to (a) enforce per-company PIN
--                 uniqueness via a DB unique index and (b) identify the employee
--                 at keypad login without an email. A salted bcrypt hash can do
--                 neither of these (equal PINs produce different hashes), which
--                 is why a second, deterministic column is required.
--
-- This mirrors the existing console-mode "pin" column, which stays in place
-- until console login is migrated onto these secure columns in a later change.
ALTER TABLE "employee" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "employee" ADD COLUMN "pinLookup" TEXT;

-- PIN uniqueness enforced within a company. The constraint lives on the
-- deterministic "pinLookup" (bcrypt "pinHash" is non-deterministic and cannot be
-- meaningfully constrained). Partial index so employees without a PIN are exempt.
CREATE UNIQUE INDEX "employee_companyId_pinLookup_key"
  ON "employee" ("companyId", "pinLookup")
  WHERE "pinLookup" IS NOT NULL;
