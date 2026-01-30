-- Backfill jobOperationId for job materials that are missing it
-- Logic: Assign each material to the first operation (by order) with the same jobMakeMethodId
WITH first_operations AS (
  SELECT DISTINCT ON ("jobMakeMethodId")
    "id" as "operationId",
    "jobMakeMethodId"
  FROM "jobOperation"
  WHERE "jobMakeMethodId" IS NOT NULL
  ORDER BY "jobMakeMethodId", "order" ASC
)
UPDATE "jobMaterial" jm
SET "jobOperationId" = fo."operationId"
FROM first_operations fo, "job" j
WHERE
  jm."jobMakeMethodId" = fo."jobMakeMethodId"
  AND jm."jobId" = j."id"
  AND jm."jobOperationId" IS NULL
  AND j."status" != 'Draft';
