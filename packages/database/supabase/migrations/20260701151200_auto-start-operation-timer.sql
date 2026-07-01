-- Passive operation timer (MES): opt-in per company. When ON, the MES assembly view
-- auto-starts the operator's production event on open (so the timer isn't forgotten), and
-- after N minutes of no screen activity prompts "Still working?" then ends the event.
-- Additive + defaulted, no backfill. Idle threshold is company-configurable (minutes).
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "autoStartOperationTimer" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "operationTimerIdleMinutes" INTEGER NOT NULL DEFAULT 5;
