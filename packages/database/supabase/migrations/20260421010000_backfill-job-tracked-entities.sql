-- =============================================================================
-- Backfill: restore the seed trackedEntity + tracking flags for existing jobs
-- that were created between 20260410031803_job-interceptors.sql and
-- 20260421000000_fix-job-make-method-interceptor.sql.
--
-- During that window, sync_insert_job_make_method did not set
-- requiresSerialTracking/requiresBatchTracking on the root jobMakeMethod and
-- did not insert the seed trackedEntity that JobProperties keys the
-- Serial/Batch Number input off of. This migration repairs both.
--
-- Idempotent: the INSERT is gated by NOT EXISTS on
-- attributes->>'Job Make Method', and the flag UPDATE is gated by IS DISTINCT
-- FROM.
-- =============================================================================

WITH root_methods AS (
  SELECT
    jmm."id"           AS job_make_method_id,
    jmm."jobId"        AS job_id,
    jmm."itemId"       AS item_id,
    jmm."companyId"    AS company_id,
    jmm."createdBy"    AS created_by,
    j."quantity"       AS job_quantity,
    i."readableIdWithRevision" AS item_readable_id,
    i."itemTrackingType"       AS item_tracking_type
  FROM "jobMakeMethod" jmm
  INNER JOIN "job"  j ON j."id" = jmm."jobId"
  INNER JOIN "item" i ON i."id" = jmm."itemId"
  WHERE jmm."parentMaterialId" IS NULL
    AND i."itemTrackingType" IN ('Serial', 'Batch')
),
flag_fix AS (
  UPDATE "jobMakeMethod" jmm
  SET "requiresSerialTracking" = (rm.item_tracking_type = 'Serial'),
      "requiresBatchTracking"  = (rm.item_tracking_type = 'Batch')
  FROM root_methods rm
  WHERE jmm."id" = rm.job_make_method_id
    AND (
      jmm."requiresSerialTracking" IS DISTINCT FROM (rm.item_tracking_type = 'Serial')
      OR jmm."requiresBatchTracking" IS DISTINCT FROM (rm.item_tracking_type = 'Batch')
    )
  RETURNING jmm."id"
)
INSERT INTO "trackedEntity" (
  "sourceDocument", "sourceDocumentId", "sourceDocumentReadableId",
  "quantity", "status", "companyId", "createdBy", "attributes"
)
SELECT
  'Item',
  rm.item_id,
  rm.item_readable_id,
  COALESCE(rm.job_quantity, 1),
  'Reserved',
  rm.company_id,
  rm.created_by,
  jsonb_build_object('Job', rm.job_id, 'Job Make Method', rm.job_make_method_id)
FROM root_methods rm
WHERE NOT EXISTS (
  SELECT 1 FROM "trackedEntity" te
  WHERE te."attributes"->>'Job Make Method' = rm.job_make_method_id
);
