-- Add break type to timeClockEntry and expand dashboard view with shift schedule columns

-- 1. Add type column (shift_end = normal clock out, break = break clock out)
ALTER TABLE "timeClockEntry" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'shift_end';

-- 2. Drop and recreate dashboard view with type + shift schedule columns
DROP VIEW IF EXISTS "timeClockDashboard";
CREATE VIEW "timeClockDashboard" WITH (SECURITY_INVOKER=true) AS
SELECT
  tce."id",
  tce."employeeId",
  tce."companyId",
  tce."clockIn",
  tce."clockOut",
  tce."note",
  tce."type",
  tce."autoCloseShiftId",
  tce."createdBy",
  tce."createdAt",
  tce."updatedBy",
  tce."updatedAt",
  u."firstName",
  u."lastName",
  u."avatarUrl",
  ej."title" AS "jobTitle",
  ej."shiftId",
  s."name" AS "shiftName",
  s."startTime" AS "shiftStartTime",
  s."endTime" AS "shiftEndTime",
  s."sunday" AS "shiftSunday",
  s."monday" AS "shiftMonday",
  s."tuesday" AS "shiftTuesday",
  s."wednesday" AS "shiftWednesday",
  s."thursday" AS "shiftThursday",
  s."friday" AS "shiftFriday",
  s."saturday" AS "shiftSaturday"
FROM "timeClockEntry" tce
INNER JOIN "user" u ON tce."employeeId" = u."id"
LEFT JOIN "employeeJob" ej ON ej."id" = tce."employeeId" AND ej."companyId" = tce."companyId"
LEFT JOIN "shift" s ON ej."shiftId" = s."id";
