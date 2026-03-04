ALTER TABLE "companySettings" ADD COLUMN "accountsPayableEmail" TEXT;
ALTER TABLE "companySettings" ADD COLUMN "accountsReceivableEmail" TEXT;

ALTER TABLE "company" ADD COLUMN "vatNumber" TEXT;

ALTER TABLE "customer" ADD COLUMN "vatNumber" TEXT;
ALTER TABLE "supplier" ADD COLUMN "vatNumber" TEXT;

-- Recreate purchaseOrderLocations view to include supplier taxId and vatNumber
DROP VIEW IF EXISTS "purchaseOrderLocations";
CREATE OR REPLACE VIEW "purchaseOrderLocations" WITH(SECURITY_INVOKER=true) AS
  SELECT
    po.id,
    s.name AS "supplierName",
    sa."addressLine1" AS "supplierAddressLine1",
    sa."addressLine2" AS "supplierAddressLine2",
    sa."city" AS "supplierCity",
    sa."stateProvince" AS "supplierStateProvince",
    sa."postalCode" AS "supplierPostalCode",
    sa."countryCode" AS "supplierCountryCode",
    sc."name" AS "supplierCountryName",
    s."taxId" AS "supplierTaxId",
    s."vatNumber" AS "supplierVatNumber",
    dl.name AS "deliveryName",
    dl."addressLine1" AS "deliveryAddressLine1",
    dl."addressLine2" AS "deliveryAddressLine2",
    dl."city" AS "deliveryCity",
    dl."stateProvince" AS "deliveryStateProvince",
    dl."postalCode" AS "deliveryPostalCode",
    dl."countryCode" AS "deliveryCountryCode",
    dc."name" AS "deliveryCountryName",
    pod."dropShipment",
    c.name AS "customerName",
    ca."addressLine1" AS "customerAddressLine1",
    ca."addressLine2" AS "customerAddressLine2",
    ca."city" AS "customerCity",
    ca."stateProvince" AS "customerStateProvince",
    ca."postalCode" AS "customerPostalCode",
    ca."countryCode" AS "customerCountryCode",
    cc."name" AS "customerCountryName"
  FROM "purchaseOrder" po
  LEFT OUTER JOIN "supplier" s
    ON s.id = po."supplierId"
  LEFT OUTER JOIN "supplierLocation" sl
    ON sl.id = po."supplierLocationId"
  LEFT OUTER JOIN "address" sa
    ON sa.id = sl."addressId"
  LEFT OUTER JOIN "country" sc
    ON sc.alpha2 = sa."countryCode"
  INNER JOIN "purchaseOrderDelivery" pod
    ON pod.id = po.id
  LEFT OUTER JOIN "location" dl
    ON dl.id = pod."locationId"
  LEFT OUTER JOIN "country" dc
    ON dc.alpha2 = dl."countryCode"
  LEFT OUTER JOIN "customer" c
    ON c.id = pod."customerId"
  LEFT OUTER JOIN "customerLocation" cl
    ON cl.id = pod."customerLocationId"
  LEFT OUTER JOIN "address" ca
    ON ca.id = cl."addressId"
  LEFT OUTER JOIN "country" cc
    ON cc.alpha2 = ca."countryCode";

-- Recreate purchaseOrders view to include creator info
DROP VIEW IF EXISTS "purchaseOrders";
CREATE OR REPLACE VIEW "purchaseOrders" WITH(SECURITY_INVOKER=true) AS
  SELECT
    p.*,
    pl."thumbnailPath",
    pl."itemType",
    pl."orderTotal" + pd."supplierShippingCost" * p."exchangeRate" AS "orderTotal",
    pd."shippingMethodId",
    pd."shippingTermId",
    pd."receiptRequestedDate",
    pd."receiptPromisedDate",
    pd."deliveryDate",
    pd."dropShipment",
    pp."paymentTermId",
    pd."locationId",
    pd."supplierShippingCost",
    u."fullName" AS "createdByFullName",
    u."email" AS "createdByEmail"
  FROM "purchaseOrder" p
  LEFT JOIN (
    SELECT
      pol."purchaseOrderId",
      MIN(CASE
        WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
        ELSE i."thumbnailPath"
      END) AS "thumbnailPath",
      SUM(COALESCE(pol."purchaseQuantity", 0)*(COALESCE(pol."unitPrice", 0)) + COALESCE(pol."shippingCost", 0) + COALESCE(pol."taxAmount", 0)) AS "orderTotal",
      MIN(i."type") AS "itemType"
    FROM "purchaseOrderLine" pol
    LEFT JOIN "item" i
      ON i."id" = pol."itemId"
    LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
    GROUP BY pol."purchaseOrderId"
  ) pl ON pl."purchaseOrderId" = p."id"
  LEFT JOIN "purchaseOrderDelivery" pd ON pd."id" = p."id"
  LEFT JOIN "shippingTerm" st ON st."id" = pd."shippingTermId"
  LEFT JOIN "purchaseOrderPayment" pp ON pp."id" = p."id"
  LEFT JOIN "user" u ON u."id" = p."createdBy";


DROP VIEW IF EXISTS "companies";
CREATE OR REPLACE VIEW "companies" WITH(SECURITY_INVOKER=true) AS
  SELECT DISTINCT
    c.*,
    uc.*,
    et.name AS "employeeType"
    FROM "userToCompany" uc
    INNER JOIN "company" c
      ON c.id = uc."companyId"
    LEFT JOIN "employee" e
      ON e.id = uc."userId" AND e."companyId" = uc."companyId"
    LEFT JOIN "employeeType" et
      ON et.id = e."employeeTypeId";

ALTER POLICY "Users can view other users from their same company" ON "user" USING (
   id = auth.uid()::text OR
   "id" IN (
        SELECT "userId" FROM "userToCompany" WHERE "companyId" IN (
            SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
        )
   )
);


DROP VIEW IF EXISTS "suppliers";
CREATE OR REPLACE VIEW "suppliers" WITH(SECURITY_INVOKER=true) AS
      SELECT
        s.id,
        s.name,
        s."supplierTypeId",
        s."supplierStatusId",
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
        s."invoicingContactId",
        s.embedding,
        s."defaultCc",
        st.name AS "type",
        ss.name AS "status",
        po.count AS "orderCount",
        p.count AS "partCount",
        pc."workPhone" AS "phone",
        pc.fax AS "fax"
      FROM "supplier" s
      LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
      LEFT JOIN "supplierStatus" ss ON ss.id = s."supplierStatusId"
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



DROP VIEW IF EXISTS "customers";
CREATE OR REPLACE VIEW "customers" WITH(SECURITY_INVOKER=true) AS
  SELECT
    c.id,
    c.name,
    c."customerTypeId",
    c."customerStatusId",
    c."taxId",
    c."accountManagerId",
    c.logo,
    c.assignee,
    c."taxPercent",
    c.website,
    c."companyId",
    c."createdAt",
    c."createdBy",
    c."updatedAt",
    c."updatedBy",
    c."customFields",
    c."currencyCode",
    c."salesContactId",
    c."invoicingContactId",
    c."defaultCc",
    c."vatNumber",
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
      WHERE eim."entityType" = 'customer' AND eim."entityId" = c.id
    ) AS "externalId",
    ct.name AS "type",
    cs.name AS "status",
    so.count AS "orderCount",
    pc."workPhone" AS "phone",
    pc."fax" AS "fax"
  FROM "customer" c
  LEFT JOIN "customerType" ct ON ct.id = c."customerTypeId"
  LEFT JOIN "customerStatus" cs ON cs.id = c."customerStatusId"
  LEFT JOIN (
    SELECT
      "customerId",
      COUNT(*) AS "count"
    FROM "salesOrder"
    GROUP BY "customerId"
  ) so ON so."customerId" = c.id
  LEFT JOIN (
    SELECT DISTINCT ON (cc."customerId")
      cc."customerId",
      co."workPhone",
      co."fax"
    FROM "customerContact" cc
    INNER JOIN "contact" co ON co.id = cc."contactId"
    ORDER BY cc."customerId"
  ) pc ON pc."customerId" = c.id;