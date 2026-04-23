-- =============================================================================
-- Shelf-life interceptor for job operations.
--
-- Stamps `expirationDate` on tracked entities produced by a job operation
-- based on the parent item's itemShelfLife policy. Three modes:
--
--   Fixed Duration: today + days, gated on triggerProcessId matching the
--     operation's processId AND triggerTiming matching the transition
--     (Before = In Progress, After = Done). No trigger process = no stamp.
--
--   Calculated: min(ancestor expirationDate) across the inputs of this
--     operation's trackedActivity. Fires on Done only.
--
--   Set on Receipt: no-op (handled by receipt UI, not the job path).
--
-- Idempotent: only writes when expirationDate is currently NULL. A
-- retransition or a later op that also matches won't overwrite an
-- existing stamp.
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_stamp_shelf_life_on_job_operation(
  p_job_operation_id TEXT,
  p_timing TEXT -- 'Before' or 'After'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_process_id TEXT;
  v_item_id TEXT;
  v_mode TEXT;
  v_days NUMERIC;
  v_trigger_process_id TEXT;
  v_trigger_timing TEXT;
  v_expiration TEXT;
BEGIN
  -- jobOperation -> job -> item. Item may be null for ad-hoc / make-method-only
  -- operations; bail in that case.
  SELECT jo."processId", j."itemId"
    INTO v_process_id, v_item_id
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  WHERE jo.id = p_job_operation_id;

  IF v_item_id IS NULL THEN RETURN; END IF;

  SELECT mode, days, "triggerProcessId", "triggerTiming"
    INTO v_mode, v_days, v_trigger_process_id, v_trigger_timing
  FROM "itemShelfLife"
  WHERE "itemId" = v_item_id;

  -- Absent row = NotManaged = no-op.
  IF NOT FOUND THEN RETURN; END IF;

  IF v_mode = 'Fixed Duration' THEN
    -- Without a trigger process we don't know which op should fire, so skip.
    -- Users who want Fixed Duration stamping through the production path
    -- must pick a trigger process; those who don't can set expiry manually
    -- or via another workflow (e.g. Set on Receipt for Buy items).
    IF v_trigger_process_id IS NULL THEN RETURN; END IF;
    IF v_trigger_process_id != v_process_id THEN RETURN; END IF;
    IF v_trigger_timing != p_timing THEN RETURN; END IF;

    v_expiration := (CURRENT_DATE + v_days::int)::text;

    UPDATE "trackedEntity" te
    SET attributes = jsonb_set(
      COALESCE(te.attributes, '{}'::jsonb),
      '{expirationDate}',
      to_jsonb(v_expiration)
    )
    WHERE (te.attributes->>'expirationDate') IS NULL
      AND te.id IN (
        SELECT tao."trackedEntityId"
        FROM "trackedActivityOutput" tao
        JOIN "trackedActivity" ta ON ta.id = tao."trackedActivityId"
        WHERE ta."sourceDocument" = 'Job Operation'
          AND ta."sourceDocumentId" = p_job_operation_id
      );
    RETURN;
  END IF;

  IF v_mode = 'Calculated' AND p_timing = 'After' THEN
    -- For each output of this operation with no expiry yet, compute the
    -- minimum expirationDate across the inputs of the same trackedActivity
    -- and stamp it. ISO dates sort lexicographically = chronologically, so
    -- MIN on text is safe.
    UPDATE "trackedEntity" te
    SET attributes = jsonb_set(
      COALESCE(te.attributes, '{}'::jsonb),
      '{expirationDate}',
      to_jsonb(ancestors.min_expiry)
    )
    FROM (
      SELECT
        tao."trackedEntityId" AS output_id,
        MIN(anc.attributes->>'expirationDate') AS min_expiry
      FROM "trackedActivityOutput" tao
      JOIN "trackedActivity" ta ON ta.id = tao."trackedActivityId"
      JOIN "trackedActivityInput" tai ON tai."trackedActivityId" = ta.id
      JOIN "trackedEntity" anc ON anc.id = tai."trackedEntityId"
      WHERE ta."sourceDocument" = 'Job Operation'
        AND ta."sourceDocumentId" = p_job_operation_id
        AND (anc.attributes->>'expirationDate') IS NOT NULL
      GROUP BY tao."trackedEntityId"
    ) ancestors
    WHERE te.id = ancestors.output_id
      AND (te.attributes->>'expirationDate') IS NULL
      AND ancestors.min_expiry IS NOT NULL;
  END IF;

  -- 'Set on Receipt' is handled at the goods-in UI (ReceiptLines). Nothing
  -- to do from the production path.
END;
$$;


-- =============================================================================
-- Wire the stamper into the existing production interceptors.
--
-- Before-timing stamping fires when a productionEvent opens on the op (the
-- existing `sync_set_job_operation_in_progress` hook). After-timing fires
-- inside `sync_finish_job_operation` once status transitions to Done.
--
-- Both stampers are guarded internally so hooking them unconditionally is
-- safe even for items with no shelf-life policy.
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_set_job_operation_in_progress(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_operation_id TEXT;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  v_job_operation_id := p_new->>'jobOperationId';

  -- Only set to In Progress if endTime is NULL (event is starting, not already ended)
  IF (p_new->>'endTime') IS NULL THEN
    UPDATE "jobOperation"
    SET "status" = 'In Progress'
    WHERE id = v_job_operation_id;

    -- Stamp expiry on tracked entities for 'Before' timing (shelf-life clock
    -- starts when the configured trigger process begins).
    PERFORM sync_stamp_shelf_life_on_job_operation(v_job_operation_id, 'Before');
  END IF;

  -- Set parent job to In Progress if it is still Ready
  UPDATE "job"
  SET "status" = 'In Progress'
  WHERE id = (
    SELECT "jobId" FROM "jobOperation" WHERE id = v_job_operation_id
  )
  AND "status" = 'Ready';
END;
$$;


CREATE OR REPLACE FUNCTION sync_finish_job_operation(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;
  IF (p_new->>'status') != 'Done' OR (p_old->>'status') = 'Done' THEN RETURN; END IF;

  -- Close all open production events for this operation
  UPDATE "productionEvent"
  SET "endTime" = NOW()
  WHERE "jobOperationId" = p_new->>'id'
    AND "endTime" IS NULL;

  -- Unlock dependent operations whose dependencies are now all done
  UPDATE "jobOperation" op
  SET status = 'Ready'
  WHERE EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep
    WHERE dep."operationId" = op.id
      AND dep."dependsOnId" = p_new->>'id'
      AND op.status = 'Waiting'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "jobOperationDependency" dep2
    JOIN "jobOperation" jo2 ON jo2.id = dep2."dependsOnId"
    WHERE dep2."operationId" = op.id
      AND jo2.status != 'Done'
      AND jo2.id != p_new->>'id'
  );

  -- Stamp expiry on tracked entities for 'After' timing (shelf-life clock
  -- starts when the configured trigger process completes, or for Calculated
  -- items, derive expiry from consumed materials).
  PERFORM sync_stamp_shelf_life_on_job_operation(p_new->>'id', 'After');
END;
$$;
