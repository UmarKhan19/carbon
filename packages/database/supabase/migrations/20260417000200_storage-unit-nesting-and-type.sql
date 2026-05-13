-- ============================================================================
-- M3: Add nesting (parentId) to storageUnit plus the storageUnit <-> storageType
-- M2M join table. Enforce three invariants via event-system interceptors:
--   - parent must share locationId with the child
--   - a storage unit cannot change locationId if it has children
--   - no cycles in the parent chain
-- Plus a recursive view `storageUnits_recursive` for tree rendering and
-- subtree rollup queries, mirroring `groups_recursive` in
-- 20230123004632_groups.sql.
--
-- Validators run as BEFORE ROW sync interceptors via attach_event_trigger()
-- (see 20260116215036_event_system_impl.sql and
-- 20260410030406_event-system-after-interceptors.sql), matching the pattern
-- used for customer / supplier / item / job / invoice validations.
-- Each interceptor has the signature
--   (p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB) RETURNS VOID
-- and RAISE EXCEPTIONs to block the write. Functions short-circuit when the
-- operation or payload doesn't apply.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns, FKs, indexes
--    storageTypeIds is a plain TEXT[] of storageType.id values - a storage
--    unit can carry any number of types (Cold / Hazardous / Returns etc.).
--    No FK enforcement on array members by design; app code reconciles by
--    fetching the current storageType list and dropping stale ids on write.
-- ----------------------------------------------------------------------------
ALTER TABLE "storageUnit"
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "storageTypeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD CONSTRAINT "storageUnit_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "storageUnit"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "storageUnit_noSelfParent" CHECK ("parentId" IS NULL OR "parentId" <> "id");

CREATE INDEX "storageUnit_parentId_idx" ON "storageUnit" ("parentId");
CREATE INDEX "storageUnit_storageTypeIds_idx"
  ON "storageUnit" USING GIN ("storageTypeIds");

-- ----------------------------------------------------------------------------
-- 3. Interceptor: parent.locationId must equal child.locationId.
--    Fires on INSERT and UPDATE when parentId is set.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION storage_unit_enforce_same_location(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_parent_id       TEXT;
  v_parent_location TEXT;
  v_new_location    TEXT;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  v_parent_id := p_new->>'parentId';
  IF v_parent_id IS NULL THEN
    RETURN;
  END IF;

  v_new_location := p_new->>'locationId';

  SELECT "locationId"
  INTO v_parent_location
  FROM "storageUnit"
  WHERE "id" = v_parent_id;

  IF v_parent_location IS NULL THEN
    RAISE EXCEPTION 'Parent storage unit % does not exist', v_parent_id;
  END IF;

  IF v_parent_location <> v_new_location THEN
    RAISE EXCEPTION
      'Parent storage unit % is in location %, but this unit is in location %; they must match',
      v_parent_id, v_parent_location, v_new_location;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Interceptor: block locationId change on a unit that has children.
--    Fires on UPDATE only; no-op for INSERT / DELETE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION storage_unit_block_location_change_with_children(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id              TEXT;
  v_new_location    TEXT;
  v_old_location    TEXT;
BEGIN
  IF p_operation <> 'UPDATE' THEN
    RETURN;
  END IF;

  v_new_location := p_new->>'locationId';
  v_old_location := p_old->>'locationId';

  IF v_new_location IS NOT DISTINCT FROM v_old_location THEN
    RETURN;
  END IF;

  v_id := p_old->>'id';

  IF EXISTS (SELECT 1 FROM "storageUnit" WHERE "parentId" = v_id) THEN
    RAISE EXCEPTION
      'Cannot change locationId of storage unit % because it has child units',
      v_id;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Interceptor: prevent cycles in the parent chain.
--    Fires on INSERT and UPDATE when parentId is set.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION storage_unit_enforce_no_cycle(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_self_id   TEXT;
  v_cursor_id TEXT;
  v_depth     INTEGER := 0;
BEGIN
  IF p_operation NOT IN ('INSERT', 'UPDATE') THEN
    RETURN;
  END IF;

  v_cursor_id := p_new->>'parentId';
  IF v_cursor_id IS NULL THEN
    RETURN;
  END IF;

  v_self_id := p_new->>'id';

  WHILE v_cursor_id IS NOT NULL LOOP
    IF v_cursor_id = v_self_id THEN
      RAISE EXCEPTION 'Cycle detected in storage unit hierarchy at %', v_self_id;
    END IF;

    v_depth := v_depth + 1;
    IF v_depth > 1000 THEN
      RAISE EXCEPTION 'Storage unit hierarchy exceeds max depth (possible cycle)';
    END IF;

    SELECT "parentId" INTO v_cursor_id
    FROM "storageUnit"
    WHERE "id" = v_cursor_id;
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Register interceptors via the event system.
--    dispatch_event_interceptors() runs them in array order on
--    BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW.
-- ----------------------------------------------------------------------------
SELECT attach_event_trigger(
  'storageUnit',
  ARRAY[
    'storage_unit_enforce_same_location',
    'storage_unit_block_location_change_with_children',
    'storage_unit_enforce_no_cycle'
  ]::TEXT[],
  ARRAY[]::TEXT[]
);

-- ----------------------------------------------------------------------------
-- 7. Recursive view for tree rendering and subtree queries.
--    Mirrors the `groups_recursive` pattern from 20230123004632_groups.sql.
--
--    `depth` - 1-based depth (roots = 1)
--    `ancestorPath` - array of ids from root down to this node (inclusive).
--    Subtree rollup: WHERE "ancestorPath" @> ARRAY[<root_id>]
--
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW "storageUnits_recursive"
WITH (SECURITY_INVOKER = true) AS
WITH RECURSIVE t AS (
  SELECT
    "id",
    "parentId",
    "locationId",
    "warehouseId",
    "name",
    "active",
    "storageTypeIds",
    "companyId",
    1 AS "depth",
    ARRAY["id"] AS "ancestorPath"
  FROM "storageUnit"
  WHERE "parentId" IS NULL

  UNION ALL

  SELECT
    s."id",
    s."parentId",
    s."locationId",
    s."warehouseId",
    s."name",
    s."active",
    s."storageTypeIds",
    s."companyId",
    t."depth" + 1,
    t."ancestorPath" || s."id"
  FROM "storageUnit" s
  JOIN t ON s."parentId" = t."id"
)
SELECT * FROM t;
