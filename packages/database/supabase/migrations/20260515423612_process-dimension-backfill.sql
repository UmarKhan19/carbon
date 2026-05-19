INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Process', 'Process'::"dimensionEntityType", cg."id", 'system'
FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") WHERE "active" = true DO NOTHING;
