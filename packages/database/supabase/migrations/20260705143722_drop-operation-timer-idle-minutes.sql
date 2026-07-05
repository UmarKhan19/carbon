-- The idle auto clock-out was removed from the operation timer: it now only auto-starts
-- (auto clock-in) and never auto-ends, so the company-configurable idle threshold is dead.
-- Drop the column. IF EXISTS so this is a no-op on DBs that never got the column.
ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "operationTimerIdleMinutes";
