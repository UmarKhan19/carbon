-- Add departmentId to workCenter table
ALTER TABLE "workCenter"
  ADD COLUMN "departmentId" TEXT,
  ADD CONSTRAINT "workCenter_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "department" ("id") ON DELETE SET NULL;

-- Recreate workCenters view to include departmentName
DROP VIEW IF EXISTS "workCenters";
CREATE OR REPLACE VIEW "workCenters" WITH(SECURITY_INVOKER=true) AS
  SELECT
     wc.*,
     l.name as "locationName",
     d.name as "departmentName",
     wcp.processes
  FROM "workCenter" wc
  LEFT JOIN "location" l
    ON wc."locationId" = l.id
  LEFT JOIN "department" d
    ON wc."departmentId" = d.id
  LEFT JOIN (
    SELECT
      "workCenterId",
      array_agg("processId"::text) as processes
    FROM "workCenterProcess" wcp
    INNER JOIN "process" p ON wcp."processId" = p.id
    GROUP BY "workCenterId"
  ) wcp ON wc.id = wcp."workCenterId";

-- Recreate workCentersWithBlockingStatus view to include departmentId
DROP VIEW IF EXISTS "workCentersWithBlockingStatus";
CREATE OR REPLACE VIEW "workCentersWithBlockingStatus" WITH (security_invoker = true) AS
SELECT
  wc.*,
  l.name AS "locationName",
  COALESCE(
    (SELECT COUNT(*) > 0
     FROM "maintenanceDispatch" md
     WHERE md."workCenterId" = wc.id
       AND md.status = 'In Progress'
       AND md."oeeImpact" IN ('Down', 'Planned')
    ), false
  ) AS "isBlocked",
  (
    SELECT md.id
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchId",
  (
    SELECT md."maintenanceDispatchId"
    FROM "maintenanceDispatch" md
    WHERE md."workCenterId" = wc.id
      AND md.status = 'In Progress'
      AND md."oeeImpact" IN ('Down', 'Planned')
    ORDER BY md."createdAt" DESC
    LIMIT 1
  ) AS "blockingDispatchReadableId"
FROM "workCenter" wc
LEFT JOIN "location" l ON wc."locationId" = l.id;

-- Backfill: add Work Center dimension for all existing company groups
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Work Center', 'WorkCenter'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;
