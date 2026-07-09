-- Standard cost components on "itemCost".
--
-- Support the standard-cost roll-up (BOM material + routing labor + applied
-- overhead) and variance decomposition for standard-costed items. Additive and
-- idempotent. No existing view selects "itemCost".* (consumers join and select
-- named columns), so none need redefinition; no code reads these columns yet —
-- they are populated by the roll-up engine in a later phase.
--
-- Uses bare NUMERIC to match the current convention (unitCost was widened from
-- NUMERIC(15,5) to NUMERIC in 20250204164256_numeric-increase-2.sql).

ALTER TABLE "itemCost"
  ADD COLUMN IF NOT EXISTS "standardMaterialCost" NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "standardLaborCost" NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "standardOverheadCost" NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "standardCostRolledAt" TIMESTAMP WITH TIME ZONE;
