-- Grant assembly permissions to protected employee types (Admin, Management)
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "view", "create", "update", "delete")
SELECT
  et.id,
  'Assembly',
  ARRAY[et."companyId"],
  ARRAY[et."companyId"],
  ARRAY[et."companyId"],
  ARRAY[et."companyId"]
FROM "employeeType" et
WHERE et.protected = true
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;

-- Also grant to non-protected types so all users can access
INSERT INTO "employeeTypePermission" ("employeeTypeId", "module", "view", "create", "update", "delete")
SELECT
  et.id,
  'Assembly',
  ARRAY[et."companyId"],
  ARRAY[et."companyId"],
  ARRAY[et."companyId"],
  ARRAY[et."companyId"]
FROM "employeeType" et
WHERE et.protected = false
ON CONFLICT ("employeeTypeId", "module") DO NOTHING;
