-- Three-state containment: Contained / Uncontained / N/A
-- Previously all issues without an active containment task defaulted to 'Uncontained',
-- but not every issue requires containment. Now:
--   Contained   = containment task exists and is In Progress or Completed
--   Uncontained = containment task exists but is Pending or Skipped
--   N/A         = no containment task at all

CREATE OR REPLACE VIEW "issues" WITH(SECURITY_INVOKER=true) AS
  SELECT
    ncr.*,
    nci."items",
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "nonConformanceActionTask" ncat
        JOIN "nonConformanceRequiredAction" ncra ON ncat."actionTypeId" = ncra.id
        WHERE ncat."nonConformanceId" = ncr.id
          AND ncra."systemType" = 'containment'
          AND ncat.status IN ('In Progress', 'Completed')
      ) THEN 'Contained'
      WHEN EXISTS (
        SELECT 1 FROM "nonConformanceActionTask" ncat
        JOIN "nonConformanceRequiredAction" ncra ON ncat."actionTypeId" = ncra.id
        WHERE ncat."nonConformanceId" = ncr.id
          AND ncra."systemType" = 'containment'
      ) THEN 'Uncontained'
      ELSE 'N/A'
    END AS "containmentStatus"
  FROM "nonConformance" ncr
  LEFT JOIN (
    SELECT "nonConformanceId", array_agg("itemId"::text) as items
    FROM "nonConformanceItem"
    GROUP BY "nonConformanceId"
  ) nci ON nci."nonConformanceId" = ncr."id";
