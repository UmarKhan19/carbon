-- Fix: sync_finish_job_operation was missing the job completion logic.
--
-- When migration 20260410031809 converted finish_job_operation (trigger) to
-- sync_finish_job_operation (event interceptor), it correctly ported:
--   1. Closing open production events
--   2. Unlocking dependent operations
-- But it omitted:
--   3. Checking is_last_job_operation() and marking the job as Completed
--      (including the inventory edge-function call for make-to-stock jobs)
--
-- Notifications are handled separately by sync_job_complete_or_canceled
-- (job-interceptors migration) which fires when job.status changes to Completed.

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
DECLARE
  v_job_status TEXT;
  v_job_location_id TEXT;
  v_job_shelf_id TEXT;
  v_job_quantity NUMERIC;
  v_sales_order_id TEXT;
  v_quantity_complete NUMERIC;
BEGIN
  -- Only fire when status transitions to 'Done'
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

  -- Only complete the job if it is in an active state (has been released/started)
  SELECT status INTO v_job_status FROM "job" WHERE id = p_new->>'jobId';
  IF v_job_status NOT IN ('Ready', 'In Progress', 'Paused') THEN
    RETURN;
  END IF;

  -- If this is the last operation, mark the job as Completed
  IF is_last_job_operation(p_new->>'id') THEN
    SELECT "locationId", "shelfId", quantity, "salesOrderId"
    INTO v_job_location_id, v_job_shelf_id, v_job_quantity, v_sales_order_id
    FROM "job"
    WHERE id = p_new->>'jobId';

    v_quantity_complete := CASE
      WHEN COALESCE((p_new->>'quantityComplete')::NUMERIC, 0) = 0 THEN v_job_quantity
      ELSE (p_new->>'quantityComplete')::NUMERIC
    END;

    IF v_sales_order_id IS NOT NULL THEN
      -- Make-to-order: update job status and quantityComplete
      UPDATE "job"
      SET status = 'Completed',
          "completedDate" = NOW(),
          "quantityComplete" = v_quantity_complete,
          "updatedAt" = NOW(),
          "updatedBy" = p_new->>'updatedBy'
      WHERE id = p_new->>'jobId';
    ELSE
      -- Make-to-stock: update job status and invoke inventory edge function
      UPDATE "job"
      SET status = 'Completed',
          "completedDate" = NOW(),
          "updatedAt" = NOW(),
          "updatedBy" = p_new->>'updatedBy'
      WHERE id = p_new->>'jobId';

      PERFORM util.invoke_edge_function(
        name => 'issue',
        body => CASE
          WHEN v_job_shelf_id IS NOT NULL THEN
            jsonb_build_object(
              'type', 'jobCompleteInventory',
              'jobId', p_new->>'jobId',
              'companyId', p_new->>'companyId',
              'userId', p_new->>'updatedBy',
              'quantityComplete', v_quantity_complete,
              'locationId', v_job_location_id,
              'shelfId', v_job_shelf_id
            )
          ELSE
            jsonb_build_object(
              'type', 'jobCompleteInventory',
              'jobId', p_new->>'jobId',
              'companyId', p_new->>'companyId',
              'userId', p_new->>'updatedBy',
              'quantityComplete', v_quantity_complete,
              'locationId', v_job_location_id
            )
        END
      );
    END IF;
  END IF;
END;
$$;
