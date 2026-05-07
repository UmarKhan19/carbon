-- Fix finish-to propagation trigger so it does not depend on
-- activeMakeMethods exposing finishToStorageUnitId.
--
-- Why: activeMakeMethods was created with SELECT * earlier, and in Postgres
-- view column lists are frozen at creation time. Newly added table columns
-- are not guaranteed to appear in existing views.

CREATE OR REPLACE FUNCTION trigger_propagate_finish_to_storage_unit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_finish_to TEXT;
BEGIN
  -- Only top-level job make methods should drive job default staging shelf.
  IF NEW."parentMaterialId" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve active make method id from the view, then read finish-to from base table.
  SELECT mm."finishToStorageUnitId"
  INTO v_finish_to
  FROM "activeMakeMethods" amm
  INNER JOIN "makeMethod" mm ON mm.id = amm.id
  WHERE amm."itemId" = NEW."itemId"
    AND amm."companyId" = NEW."companyId"
  LIMIT 1;

  IF v_finish_to IS NOT NULL THEN
    UPDATE "job"
    SET "finishToStorageUnitId" = v_finish_to
    WHERE id = NEW."jobId"
      AND "companyId" = NEW."companyId"
      AND "finishToStorageUnitId" IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
