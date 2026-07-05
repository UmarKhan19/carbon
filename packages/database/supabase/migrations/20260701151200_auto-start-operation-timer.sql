-- Passive operation timer (MES): opt-in per company. When ON, the MES assembly view
-- auto-starts the operator's production event on open (so the timer isn't forgotten).
-- It never auto-ends a timer — stopping is always a manual action.
-- Additive + defaulted, no backfill.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "autoStartOperationTimer" BOOLEAN NOT NULL DEFAULT false;
