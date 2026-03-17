-- Three-state Containment: Contained / Uncontained / N/A
-- Previously all issues without an active Containment task defaulted to 'Uncontained',
-- but not every issue requires Containment. Now:
--   Contained   = Containment task exists and is In Progress or Completed
--   Uncontained = Containment task exists but is Pending or Skipped
--   N/A         = no Containment task at all

CREATE OR REPLACE VIEW "issues" WITH(SECURITY_INVOKER=true) AS
  SELECT
    ncr.*,
    nci."items",
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "nonConformanceActionTask" ncat
        JOIN "nonConformanceRequiredAction" ncra ON ncat."actionTypeId" = ncra.id
        WHERE ncat."nonConformanceId" = ncr.id
          AND ncra."systemType" = 'Containment'
          AND ncat.status IN ('In Progress', 'Completed')
      ) THEN 'Contained'
      WHEN EXISTS (
        SELECT 1 FROM "nonConformanceActionTask" ncat
        JOIN "nonConformanceRequiredAction" ncra ON ncat."actionTypeId" = ncra.id
        WHERE ncat."nonConformanceId" = ncr.id
          AND ncra."systemType" = 'Containment'
      ) THEN 'Uncontained'
      ELSE 'N/A'
    END AS "ContainmentStatus"
  FROM "nonConformance" ncr
  LEFT JOIN (
    SELECT "nonConformanceId", array_agg("itemId"::text) as items
    FROM "nonConformanceItem"
    GROUP BY "nonConformanceId"
  ) nci ON nci."nonConformanceId" = ncr."id";
