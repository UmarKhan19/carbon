-- ============================================================================
-- Migration: 20260427000000_consolidate-inventory-shelf-life-settings
--
-- Goal:
--   Move every shelf-life knob into the existing companySettings.inventoryShelfLife
--   JSONB blob and drop the now-redundant flat columns. New blob shape:
--
--     {
--       "calculatedInputScope": "AllInputs" | "ManagedInputsOnly",
--       "expiredEntityPolicy":   "Warn" | "Block" | "BlockWithOverride",
--       "nearExpiryWarningDays": number | null,
--       "defaultShelfLifeDays":  number
--     }
--
--   Adds the new "expiredEntityPolicy" knob in the same pass — controls what
--   happens when an operator tries to consume a tracked entity past its
--   expirationDate. Default 'Block' so the safe behavior is the default.
--
-- Steps:
--   1. Backfill the JSONB with values from the existing flat columns plus
--      the new expiredEntityPolicy default.
--   2. Drop "nearExpiryWarningDays" and "defaultShelfLifeDays" columns from
--      companySettings.
--   3. No DB function changes — set_shelf_life_for_operation never read the
--      flat columns; everything else reads via the JSONB now.
-- ============================================================================

-- 1. Backfill: merge flat-column values + default expiredEntityPolicy into
--    the JSONB. `||` keeps any existing keys that already match (idempotent).
UPDATE "companySettings"
SET "inventoryShelfLife" = COALESCE("inventoryShelfLife", '{}'::JSONB)
  || jsonb_build_object(
       'nearExpiryWarningDays', "nearExpiryWarningDays",
       'defaultShelfLifeDays',  "defaultShelfLifeDays",
       'expiredEntityPolicy',   COALESCE(
         "inventoryShelfLife"->>'expiredEntityPolicy',
         'Block'
       )
     );


-- 2. Drop the flat columns.
ALTER TABLE "companySettings"
  DROP COLUMN IF EXISTS "nearExpiryWarningDays",
  DROP COLUMN IF EXISTS "defaultShelfLifeDays";
