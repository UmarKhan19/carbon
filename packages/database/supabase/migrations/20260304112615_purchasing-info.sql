ALTER TABLE "companySettings" ADD COLUMN "accountsPayableEmail" TEXT;
ALTER TABLE "companySettings" ADD COLUMN "accountsReceivableEmail" TEXT;

ALTER TABLE "company" ADD COLUMN "vatNumber" TEXT;

ALTER TABLE "customer" ADD COLUMN "vatNumber" TEXT;
ALTER TABLE "supplier" ADD COLUMN "vatNumber" TEXT;


DROP VIEW IF EXISTS "customers";
DROP VIEW IF EXISTS "suppliers";

ALTER TABLE "customer" DROP COLUMN IF EXISTS "invoicingContactId";
ALTER TABLE "supplier" DROP COLUMN IF EXISTS "invoicingContactId";

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
    scon."fullName" AS "supplierContactName",
    scon."email" AS "supplierContactEmail",
    comp."countryCode" AS "companyCountryCode",
    compc."name" AS "companyCountryName",
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
  LEFT OUTER JOIN "supplierContact" sct
    ON sct.id = po."supplierContactId"
  LEFT OUTER JOIN "contact" scon
    ON scon.id = sct."contactId"
  LEFT OUTER JOIN "company" comp
    ON comp.id = po."companyId"
  LEFT OUTER JOIN "country" compc
    ON compc.alpha2 = comp."countryCode"
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
    cc."name" AS "countryName",
    uc.*,
    et.name AS "employeeType"
    FROM "userToCompany" uc
    INNER JOIN "company" c
      ON c.id = uc."companyId"
    LEFT JOIN "country" cc
      ON cc.alpha2 = c."countryCode"
    LEFT JOIN "employee" e
      ON e.id = uc."userId" AND e."companyId" = uc."companyId"
    LEFT JOIN "employeeType" et
      ON et.id = e."employeeTypeId";








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
    c."tags",
    c.website,
    c."companyId",
    c."createdAt",
    c."createdBy",
    c."updatedAt",
    c."updatedBy",
    c."customFields",
    c."currencyCode",
    c."salesContactId",
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

ALTER TABLE "companySettings" ADD COLUMN "accountsPayableAddress" BOOLEAN DEFAULT FALSE;
ALTER TABLE "companySettings" ADD COLUMN "accountsReceivableAddress" BOOLEAN DEFAULT FALSE;


CREATE TABLE "companyAccountsPayableBillingAddress" (
  "id" TEXT NOT NULL,
  "name" TEXT DEFAULT 'Accounts Payable',
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "city" TEXT,
  "state" TEXT,
  "postalCode" TEXT,
  "countryCode" TEXT,
  "phone" TEXT,
  "fax" TEXT,
  "email" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  CONSTRAINT "companyAccountsPayableBillingAddress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companyAccountsPayableBillingAddress_id_fkey" FOREIGN KEY ("id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);


CREATE TABLE "companyAccountsReceivableBillingAddress" (
  "id" TEXT NOT NULL,
  "name" TEXT DEFAULT 'Accounts Receivable',
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "city" TEXT,
  "state" TEXT,
  "postalCode" TEXT,
  "countryCode" TEXT,
  "phone" TEXT,
  "fax" TEXT,
  "email" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,
  CONSTRAINT "companyAccountsReceivableBillingAddress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companyAccountsReceivableBillingAddress_id_fkey" FOREIGN KEY ("id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);


-- RLS for companyAccountsPayableBillingAddress
ALTER TABLE "companyAccountsPayableBillingAddress" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."companyAccountsPayableBillingAddress"
FOR SELECT USING (
  "id" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."companyAccountsPayableBillingAddress"
FOR INSERT WITH CHECK (
  "id" = ANY ((SELECT get_companies_with_employee_permission('settings_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."companyAccountsPayableBillingAddress"
FOR UPDATE USING (
  "id" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."companyAccountsPayableBillingAddress"
FOR DELETE USING (
  "id" = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
);


-- RLS for companyAccountsReceivableBillingAddress
ALTER TABLE "companyAccountsReceivableBillingAddress" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."companyAccountsReceivableBillingAddress"
FOR SELECT USING (
  "id" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."companyAccountsReceivableBillingAddress"
FOR INSERT WITH CHECK (
  "id" = ANY ((SELECT get_companies_with_employee_permission('settings_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."companyAccountsReceivableBillingAddress"
FOR UPDATE USING (
  "id" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."companyAccountsReceivableBillingAddress"
FOR DELETE USING (
  "id" = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
);


-- Update insert_company_related_records to auto-create billing address records
CREATE OR REPLACE FUNCTION insert_company_related_records()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "terms" ("id") VALUES (NEW.id);

  INSERT INTO "companySettings" ("id", "useMetric")
  VALUES (
    NEW.id,
    CASE
      WHEN NEW."countryCode" = 'US' OR NEW."baseCurrencyCode" = 'USD' THEN false
      ELSE true
    END
  );

  INSERT INTO "companyAccountsPayableBillingAddress" ("id", "addressLine1", "addressLine2", "city", "state", "postalCode", "countryCode", "phone", "fax", "email")
  VALUES (NEW.id, NEW."addressLine1", NEW."addressLine2", NEW."city", NEW."stateProvince", NEW."postalCode", NEW."countryCode", NEW."phone", NEW."fax", NEW."email");

  INSERT INTO "companyAccountsReceivableBillingAddress" ("id", "addressLine1", "addressLine2", "city", "state", "postalCode", "countryCode", "phone", "fax", "email")
  VALUES (NEW.id, NEW."addressLine1", NEW."addressLine2", NEW."city", NEW."stateProvince", NEW."postalCode", NEW."countryCode", NEW."phone", NEW."fax", NEW."email");

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Backfill existing companies
INSERT INTO "companyAccountsPayableBillingAddress" ("id", "addressLine1", "addressLine2", "city", "state", "postalCode", "countryCode", "phone", "fax", "email")
SELECT
  c."id",
  c."addressLine1",
  c."addressLine2",
  c."city",
  c."stateProvince",
  c."postalCode",
  c."countryCode",
  c."phone",
  c."fax",
  c."email"
FROM "company" c
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "companyAccountsReceivableBillingAddress" ("id", "addressLine1", "addressLine2", "city", "state", "postalCode", "countryCode", "phone", "fax", "email")
SELECT
  c."id",
  c."addressLine1",
  c."addressLine2",
  c."city",
  c."stateProvince",
  c."postalCode",
  c."countryCode",
  c."phone",
  c."fax",
  c."email"
FROM "company" c
ON CONFLICT ("id") DO NOTHING;

DROP VIEW "purchaseOrderLines";
ALTER TABLE "purchaseOrderLine" ADD COLUMN "requestedDate" DATE;
ALTER TABLE "purchaseOrderLine" ADD COLUMN "receivedDate" DATE;

DROP VIEW IF EXISTS "purchaseOrderLines";
CREATE OR REPLACE VIEW "purchaseOrderLines" WITH(SECURITY_INVOKER=true) AS (
  SELECT DISTINCT ON (pl.id)
    pl.*,
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      WHEN i."thumbnailPath" IS NULL AND imu."thumbnailPath" IS NOT NULL THEN imu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    i.name as "itemName",
    i."readableIdWithRevision" as "itemReadableId",
    i.description as "itemDescription",
    COALESCE(mu.id, imu.id) as "modelId",
    COALESCE(mu."autodeskUrn", imu."autodeskUrn") as "autodeskUrn",
    COALESCE(mu."modelPath", imu."modelPath") as "modelPath",
    COALESCE(mu."name", imu."name") as "modelName",
    COALESCE(mu."size", imu."size") as "modelSize",
    ic."unitCost" as "unitCost",
    sp."supplierPartId",
    jo."description" as "jobOperationDescription"
  FROM "purchaseOrderLine" pl
  INNER JOIN "purchaseOrder" so ON so.id = pl."purchaseOrderId"
  LEFT JOIN "modelUpload" mu ON pl."modelUploadId" = mu."id"
  INNER JOIN "item" i ON i.id = pl."itemId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  LEFT JOIN "modelUpload" imu ON imu.id = i."modelUploadId"
  LEFT JOIN "supplierPart" sp ON sp."supplierId" = so."supplierId" AND sp."itemId" = i.id
  LEFT JOIN "jobOperation" jo ON jo."id" = pl."jobOperationId"
);