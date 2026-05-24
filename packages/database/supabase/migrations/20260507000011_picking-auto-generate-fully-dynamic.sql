-- ============================================================
-- Fix: auto-generate trigger is now purely company-settings-driven.
--
-- Root causes fixed here:
--
-- 1. The trigger checked the per-job autoGeneratePickingList value, which is
--    a stale snapshot set at INSERT and never updated. Changing the company
--    setting had no effect on existing jobs.
--
-- 2. Jobs already at 'Ready'/'In Progress'/'Paused' had their trigger fire
--    while the company default was OFF and will never get another chance.
--    Note: the UI labels 'Ready' as "Released" — the DB enum value is 'Ready'.
--
-- Fix:
--   a) Remove the per-job check — gate solely on live company settings.
--   b) Backfill: create PLs for jobs already past the trigger point that
--      still have pickingStatus = 'Not Generated'.
-- ============================================================

-- ─── 1. Update trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_auto_generate_picking_list()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_use_picking_lists         BOOLEAN;
  v_default_auto_generate     BOOLEAN;
  v_has_materials             BOOLEAN;
  v_pl_id                     TEXT;
  v_readable_id               TEXT;
BEGIN
  -- Only react when transitioning INTO Planned or Ready
  IF NEW."status" NOT IN ('Planned', 'Ready') THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = NEW."status" THEN
    RETURN NEW;
  END IF;

  -- Idempotent guard: only generate once
  IF NEW."pickingStatus" IS DISTINCT FROM 'Not Generated' THEN
    RETURN NEW;
  END IF;

  -- locationId is required for a PL
  IF NEW."locationId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- Company-wide gates: both usePickingLists and defaultAutoGeneratePickingList
  -- must be on. Reading live settings here means a company-level change takes
  -- effect immediately for all jobs, regardless of when they were created.
  SELECT
    COALESCE("usePickingLists", true),
    COALESCE("defaultAutoGeneratePickingList", true)
  INTO v_use_picking_lists, v_default_auto_generate
  FROM "companySettings"
  WHERE id = NEW."companyId";

  IF NOT COALESCE(v_use_picking_lists, true) THEN
    RETURN NEW;
  END IF;

  IF NOT COALESCE(v_default_auto_generate, true) THEN
    RETURN NEW;
  END IF;

  -- At least one qualifying material must exist
  SELECT EXISTS (
    SELECT 1 FROM "jobMaterial"
    WHERE "jobId" = NEW.id
      AND "companyId" = NEW."companyId"
      AND "methodType" = 'Pull from Inventory'
      AND "quantityToIssue" > 0
      AND "requiresPicking" = true
  ) INTO v_has_materials;

  IF NOT v_has_materials THEN
    RETURN NEW;
  END IF;

  -- All guards passed → create the PL header + lines.
  v_readable_id := get_next_sequence('pickingList', NEW."companyId");

  INSERT INTO "pickingList" (
    "pickingListId",
    "jobId",
    "locationId",
    "status",
    "companyId",
    "createdBy"
  ) VALUES (
    v_readable_id,
    NEW.id,
    NEW."locationId",
    'Draft',
    NEW."companyId",
    COALESCE(NEW."updatedBy", NEW."createdBy", 'system')
  ) RETURNING id INTO v_pl_id;

  PERFORM generate_picking_list_lines(
    v_pl_id,
    NEW.id,
    NEW."companyId",
    COALESCE(NEW."updatedBy", NEW."createdBy", 'system')
  );

  -- pickingList INSERT trigger will recompute pickingStatus → 'Generated'.
  RETURN NEW;
END;
$$;

-- ─── 2. Backfill jobs that already passed Planned/Ready with no PL ────────────
-- The trigger cannot re-fire for jobs already at Ready/In Progress/Paused.
-- Note: 'Ready' is what the UI displays as "Released".
DO $$
DECLARE
  r               RECORD;
  v_pl_id         TEXT;
  v_readable_id   TEXT;
  v_use_pl        BOOLEAN;
  v_auto_gen      BOOLEAN;
  v_has_materials BOOLEAN;
BEGIN
  FOR r IN
    SELECT
      j.id,
      j."companyId",
      j."locationId",
      COALESCE(j."updatedBy", j."createdBy", 'system') AS creator
    FROM "job" j
    WHERE j."status"        IN ('Ready', 'In Progress', 'Paused')
      AND j."pickingStatus" = 'Not Generated'
      AND j."locationId"    IS NOT NULL
  LOOP
    SELECT
      COALESCE("usePickingLists", true),
      COALESCE("defaultAutoGeneratePickingList", true)
    INTO v_use_pl, v_auto_gen
    FROM "companySettings"
    WHERE id = r."companyId";

    IF NOT COALESCE(v_use_pl, true)   THEN CONTINUE; END IF;
    IF NOT COALESCE(v_auto_gen, true) THEN CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM "jobMaterial"
      WHERE "jobId"          = r.id
        AND "companyId"      = r."companyId"
        AND "methodType"     = 'Pull from Inventory'
        AND "quantityToIssue" > 0
        AND "requiresPicking" = true
    ) INTO v_has_materials;

    IF NOT v_has_materials THEN CONTINUE; END IF;

    v_readable_id := get_next_sequence('pickingList', r."companyId");

    INSERT INTO "pickingList" (
      "pickingListId", "jobId", "locationId", "status", "companyId", "createdBy"
    ) VALUES (
      v_readable_id, r.id, r."locationId", 'Draft', r."companyId", r.creator
    ) RETURNING id INTO v_pl_id;

    PERFORM generate_picking_list_lines(v_pl_id, r.id, r."companyId", r.creator);
  END LOOP;
END;
$$;
