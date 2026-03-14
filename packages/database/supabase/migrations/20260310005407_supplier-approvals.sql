ALTER TABLE "companySettings" ADD COLUMN "supplierApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "approvalDocumentType" ADD VALUE 'supplier';
COMMIT;

-- Recreate suppliers view
DROP VIEW IF EXISTS "suppliers";
CREATE OR REPLACE VIEW "suppliers" WITH(SECURITY_INVOKER=true) AS
      SELECT
        s.id,
        s.name,
        s."supplierTypeId",
        s."supplierStatus" as "status",
        s."taxId",
        s."accountManagerId",
        s.logo,
        s.assignee,
        s."companyId",
        s."createdAt",
        s."createdBy",
        s."updatedAt",
        s."updatedBy",
        s."customFields",
        s."currencyCode",
        s."vatNumber",
        s.website,
        (
          SELECT COALESCE(
            jsonb_object_agg(
              eim."integration",
              CASE
                WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
                ELSE to_jsonb(eim."externalId")
              END
            ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
            '{}'::jsonb
          )
          FROM "externalIntegrationMapping" eim
          WHERE eim."entityType" = 'supplier' AND eim."entityId" = s.id
        ) AS "externalId",
        s.tags,
        s."taxPercent",
        s."purchasingContactId",
        s.embedding,
        s."defaultCc",
        st.name AS "type",
        po.count AS "orderCount",
        p.count AS "partCount",
        pc."workPhone" AS "phone",
        pc.fax AS "fax"
      FROM "supplier" s
      LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
      LEFT JOIN (
        SELECT
          "supplierId",
          COUNT(*) AS "count"
        FROM "purchaseOrder"
        GROUP BY "supplierId"
      ) po ON po."supplierId" = s.id
      LEFT JOIN (
        SELECT
          "supplierId",
          COUNT(*) AS "count"
        FROM "supplierPart"
        GROUP BY "supplierId"
      ) p ON p."supplierId" = s.id
    LEFT JOIN (
      SELECT DISTINCT ON (sc."supplierId")
        sc."supplierId" AS id,
        co."workPhone",
        co."fax"
      FROM "supplierContact" sc
      JOIN "contact" co
        ON co.id = sc."contactId"
      ORDER BY sc."supplierId", sc.id
    ) pc
      ON pc.id = s.id;

-- Recreate approvalRequests view to include supplier document type
DROP VIEW IF EXISTS "approvalRequests";
CREATE OR REPLACE VIEW "approvalRequests" WITH (SECURITY_INVOKER=true) AS
SELECT
  ar."id",
  ar."documentType",
  ar."documentId",
  ar."status",
  ar."requestedBy",
  ar."requestedAt",
  ar."decisionBy",
  ar."decisionAt",
  ar."decisionNotes",
  ar."companyId",
  ar."createdAt",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN po."purchaseOrderId"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."name"
    WHEN ar."documentType" = 'supplier' THEN sup."name"
    ELSE NULL
  END AS "documentReadableId",
  CASE
    WHEN ar."documentType" = 'purchaseOrder' THEN s."name"
    WHEN ar."documentType" = 'qualityDocument' THEN qd."description"
    WHEN ar."documentType" = 'supplier' THEN NULL
    ELSE NULL
  END AS "documentDescription"
FROM "approvalRequest" ar
LEFT JOIN "purchaseOrder" po ON ar."documentType" = 'purchaseOrder' AND ar."documentId" = po."id"
LEFT JOIN "supplier" s ON po."supplierId" = s."id"
LEFT JOIN "qualityDocument" qd ON ar."documentType" = 'qualityDocument' AND ar."documentId" = qd."id"
LEFT JOIN "supplier" sup ON ar."documentType" = 'supplier' AND ar."documentId" = sup."id";
