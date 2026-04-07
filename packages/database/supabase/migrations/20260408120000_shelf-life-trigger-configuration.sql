-- Shelf Life Trigger Configuration
-- Adds configurable shelf life starting logic: receipt (default),
-- production_step (triggered by a specific process), or cascading
-- (inherits earliest expiry from consumed input batches).

-- ============================================================================
-- 1. Add trigger configuration columns to itemShelfLife
-- ============================================================================

ALTER TABLE "itemShelfLife"
  ADD COLUMN "shelfLifeTrigger" TEXT NOT NULL DEFAULT 'receipt',
  ADD COLUMN "triggerProcessId" TEXT;

-- Foreign key to process table
ALTER TABLE "itemShelfLife"
  ADD CONSTRAINT "itemShelfLife_triggerProcessId_fkey"
    FOREIGN KEY ("triggerProcessId") REFERENCES "process"("id") ON DELETE SET NULL;

-- Valid trigger values
ALTER TABLE "itemShelfLife"
  ADD CONSTRAINT "itemShelfLife_shelfLifeTrigger_check"
    CHECK ("shelfLifeTrigger" IN ('receipt', 'production_step', 'cascading'));

-- When trigger is production_step, a process must be specified
ALTER TABLE "itemShelfLife"
  ADD CONSTRAINT "itemShelfLife_trigger_process_required"
    CHECK (
      "shelfLifeTrigger" != 'production_step'
      OR "triggerProcessId" IS NOT NULL
    );

-- Index for process lookup
CREATE INDEX "itemShelfLife_triggerProcessId_idx" ON "itemShelfLife"("triggerProcessId");


-- ============================================================================
-- 2. Make totalShelfLifeDays nullable for cascading trigger
-- ============================================================================

-- Drop existing constraints that depend on totalShelfLifeDays
ALTER TABLE "itemShelfLife" DROP CONSTRAINT "itemShelfLife_totalShelfLifeDays_check";
ALTER TABLE "itemShelfLife" DROP CONSTRAINT "itemShelfLife_commercial_check";
ALTER TABLE "itemShelfLife" DROP CONSTRAINT "itemShelfLife_min_remaining_check";

-- Allow NULL (cascading trigger doesn't use a duration)
ALTER TABLE "itemShelfLife" ALTER COLUMN "totalShelfLifeDays" DROP NOT NULL;

-- Conditional check: totalShelfLifeDays must be > 0 unless cascading
ALTER TABLE "itemShelfLife"
  ADD CONSTRAINT "itemShelfLife_totalShelfLifeDays_check"
    CHECK (
      "shelfLifeTrigger" = 'cascading'
      OR ("totalShelfLifeDays" IS NOT NULL AND "totalShelfLifeDays" > 0)
    );

-- Re-add related checks handling nullable totalShelfLifeDays
ALTER TABLE "itemShelfLife"
  ADD CONSTRAINT "itemShelfLife_commercial_check"
    CHECK (
      "commercialShelfLifeDays" IS NULL
      OR "totalShelfLifeDays" IS NULL
      OR "commercialShelfLifeDays" <= "totalShelfLifeDays"
    );

ALTER TABLE "itemShelfLife"
  ADD CONSTRAINT "itemShelfLife_min_remaining_check"
    CHECK (
      "minRemainingShelfLifeDays" IS NULL
      OR "totalShelfLifeDays" IS NULL
      OR "minRemainingShelfLifeDays" <= "totalShelfLifeDays"
    );


-- ============================================================================
-- 3. Update calculate_expiration_date for trigger awareness
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_expiration_date(
  p_item_id TEXT,
  p_packaging_date DATE
) RETURNS DATE AS $$
DECLARE
  v_config RECORD;
BEGIN
  SELECT "totalShelfLifeDays", "shelfLifeTrigger"
  INTO v_config
  FROM "itemShelfLife"
  WHERE "itemId" = p_item_id;

  IF v_config IS NULL THEN
    RETURN NULL;
  END IF;

  -- Cascading trigger: expiry comes from inputs, not a duration
  IF v_config."shelfLifeTrigger" = 'cascading' THEN
    RETURN NULL;
  END IF;

  IF v_config."totalShelfLifeDays" IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN p_packaging_date + v_config."totalShelfLifeDays";
END;
$$ LANGUAGE plpgsql STABLE;
