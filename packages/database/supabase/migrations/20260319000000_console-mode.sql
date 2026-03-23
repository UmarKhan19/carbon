-- Console mode: allow creating lightweight "console operators" who can pin in at
-- shared MES terminals without needing email, password, or Supabase Auth accounts.
ALTER TABLE "user" ADD COLUMN "isConsoleOperator" BOOLEAN NOT NULL DEFAULT false;

-- PIN for console mode authentication (4-digit numeric code).
-- Stored on employee (per-company) so the same user could have different PINs
-- at different companies. NULL means no PIN set (PIN entry is skipped).
ALTER TABLE "employee" ADD COLUMN "pin" TEXT;

-- Whether PIN is required for console mode pin-in.
-- When true, operators MUST have a PIN set and enter it to pin in.
-- Default true — PINs are required for accountability.
ALTER TABLE "companySettings" ADD COLUMN "consolePinRequired" BOOLEAN NOT NULL DEFAULT true;

-- Create "Console Operator" employee type for all existing companies.
-- Same pattern as "Admin" type: protected so it can't be accidentally deleted.
INSERT INTO "employeeType" (name, "companyId", protected)
SELECT 'Console Operator', id, true
FROM "company"
ON CONFLICT DO NOTHING;
