-- ============================================================
-- Fix: auto-generate trigger respects defaultAutoGeneratePickingList,
--      and the jobs view now exposes autoGeneratePickingList / pickingStatus.
--
-- Root causes fixed here:
--
-- 1. The jobs view was last defined in 20260417000300, before the picking
--    columns were added to job in 20260505000000. PostgreSQL freezes j.* at
--    view-creation time, so autoGeneratePickingList and pickingStatus were
--    invisible to the app. The UI fell back to "Inherits company default".
--
-- 2. The auto-generate trigger (20260507000001) checked job.autoGeneratePickingList
--    and usePickingLists, but NOT defaultAutoGeneratePickingList. Existing jobs
--    were created when the column default was true and were never backfilled by
--    the BEFORE-INSERT trigger (20260507000006). Changing the company default to
--    false in Settings → Inventory therefore had no effect on existing jobs.
-- ============================================================

-- ─── 1. Backfill autoGeneratePickingList for un-generated jobs ────────────────
-- Align every job that has not yet had a picking list generated (status = 'Not
-- Generated') with the company's CURRENT defaultAutoGeneratePickingList setting.
-- This is safe: these jobs have not started picking, so flipping the flag is
-- non-destructive.
UPDATE "job" j
SET "autoGeneratePickingList" = COALESCE(cs."defaultAutoGeneratePickingList", true)
FROM "companySettings" cs
WHERE j."companyId" = cs.id
  AND j."pickingStatus" = 'Not Generated';

-- ─── 2. Update trigger to also gate on defaultAutoGeneratePickingList ─────────
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

  -- Per-job opt-in
  IF COALESCE(NEW."autoGeneratePickingList", false) = false THEN
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

  -- Company-wide opt-in: both the master switch (usePickingLists) and the
  -- auto-gen default (defaultAutoGeneratePickingList) must be on.
  -- Reading the live company setting here means a company-level change takes
  -- effect for existing jobs immediately — not just newly created ones.
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

-- ─── 3. Recreate jobs view to expose picking columns ─────────────────────────
-- CREATE OR REPLACE VIEW cannot shift existing column positions, so we must
-- drop and recreate. j.* now re-expands to include autoGeneratePickingList and
-- pickingStatus which were added to job in 20260505000000.
DROP VIEW IF EXISTS "jobs";
CREATE VIEW "jobs" WITH(SECURITY_INVOKER=true) AS
WITH job_model AS (
  SELECT
    j.id AS job_id,
    j."companyId",
    COALESCE(j."modelUploadId", i."modelUploadId") AS model_upload_id
  FROM "job" j
  INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
)
SELECT
  j.*,
  jmm."id" as "jobMakeMethodId",
  i.name,
  i."readableIdWithRevision" as "itemReadableIdWithRevision",
  i.type as "itemType",
  i.name as "description",
  i."itemTrackingType",
  i.active,
  i."replenishmentSystem",
  mu.id as "modelId",
  mu."autodeskUrn",
  mu."modelPath",
  CASE
    WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  mu."name" as "modelName",
  mu."size" as "modelSize",
  so."salesOrderId" as "salesOrderReadableId",
  qo."quoteId" as "quoteReadableId"
FROM "job" j
LEFT JOIN "jobMakeMethod" jmm ON jmm."jobId" = j.id AND jmm."parentMaterialId" IS NULL
INNER JOIN "item" i ON j."itemId" = i."id" AND j."companyId" = i."companyId"
LEFT JOIN job_model jm ON j.id = jm.job_id AND j."companyId" = jm."companyId"
LEFT JOIN "modelUpload" mu ON mu.id = jm.model_upload_id
LEFT JOIN "salesOrder" so on j."salesOrderId" = so.id AND j."companyId" = so."companyId"
LEFT JOIN "quote" qo ON j."quoteId" = qo.id AND j."companyId" = qo."companyId";
