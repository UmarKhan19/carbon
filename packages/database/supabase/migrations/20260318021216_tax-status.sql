-- Tax Exemption Reason Enum
CREATE TYPE "taxExemptionReason" AS ENUM (
  'Resale',
  'Government',
  'Nonprofit',
  'Agriculture',
  'Industrial',
  'Export',
  'Medical',
  'Educational',
  'Religious',
  'Other'
);

-- Customer Tax Table (1:1 with customer)
CREATE TABLE "customerTax" (
  "customerId" TEXT NOT NULL,
  "taxId" TEXT,
  "vatNumber" TEXT,
  "taxExempt" BOOLEAN NOT NULL DEFAULT FALSE,
  "taxExemptionReason" "taxExemptionReason",
  "taxExemptionCertificateNumber" TEXT,
  "taxExemptionCertificatePath" TEXT,
  "companyId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "customerTax_pkey" PRIMARY KEY ("customerId"),
  CONSTRAINT "customerTax_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "customerTax_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "customerTax_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "customerTax_customerId_idx" ON "customerTax"("customerId");

ALTER TABLE "customerTax" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."customerTax"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_view'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."customerTax"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('sales_update'))::text[]
  )
);

-- Supplier Tax Table (1:1 with supplier)
CREATE TABLE "supplierTax" (
  "supplierId" TEXT NOT NULL,
  "taxId" TEXT,
  "vatNumber" TEXT,
  "taxExempt" BOOLEAN NOT NULL DEFAULT FALSE,
  "taxExemptionReason" "taxExemptionReason",
  "taxExemptionCertificateNumber" TEXT,
  "taxExemptionCertificatePath" TEXT,
  "companyId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "supplierTax_pkey" PRIMARY KEY ("supplierId"),
  CONSTRAINT "supplierTax_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "supplierTax_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "supplierTax_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "supplierTax_supplierId_idx" ON "supplierTax"("supplierId");

ALTER TABLE "supplierTax" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."supplierTax"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_view'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."supplierTax"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('purchasing_update'))::text[]
  )
);

-- Backfill customerTax from existing customer records
INSERT INTO "customerTax" ("customerId", "taxId", "vatNumber", "companyId")
SELECT c.id, c."taxId", c."vatNumber", c."companyId"
FROM "customer" c
ON CONFLICT ("customerId") DO NOTHING;

-- Backfill supplierTax from existing supplier records
INSERT INTO "supplierTax" ("supplierId", "taxId", "vatNumber", "companyId")
SELECT s.id, s."taxId", s."vatNumber", s."companyId"
FROM "supplier" s
ON CONFLICT ("supplierId") DO NOTHING;

-- Storage RLS for tax certificate uploads
CREATE POLICY "Employees with sales_create can upload tax certificates" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND (has_company_permission('sales_create', (storage.foldername(name))[1]) OR has_company_permission('purchasing_create', (storage.foldername(name))[1]))
    AND (storage.foldername(name))[2] = 'tax-certificates'
  );

CREATE POLICY "Employees can view tax certificates" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'tax-certificates'
  );

CREATE POLICY "Employees with sales_delete or purchasing_delete can delete tax certificates" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND (has_company_permission('sales_delete', (storage.foldername(name))[1]) OR has_company_permission('purchasing_delete', (storage.foldername(name))[1]))
    AND (storage.foldername(name))[2] = 'tax-certificates'
  );

-- Update create_customer_entries trigger to also create customerTax
CREATE OR REPLACE FUNCTION public.create_customer_entries()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."customerPayment"("customerId", "invoiceCustomerId", "companyId")
  VALUES (new.id, new.id, new."companyId");
  INSERT INTO public."customerShipping"("customerId", "shippingCustomerId", "companyId")
  VALUES (new.id, new.id, new."companyId");
  INSERT INTO public."customerTax"("customerId", "companyId")
  VALUES (new.id, new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update create_supplier_entries trigger to also create supplierTax
CREATE OR REPLACE FUNCTION public.create_supplier_entries()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public."supplierPayment"("supplierId", "invoiceSupplierId", "companyId")
  VALUES (new.id, new.id, new."companyId");
  INSERT INTO public."supplierShipping"("supplierId", "shippingSupplierId", "companyId")
  VALUES (new.id, new.id, new."companyId");
  INSERT INTO public."supplierTax"("supplierId", "companyId")
  VALUES (new.id, new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop views that depend on the columns we're removing
DROP VIEW IF EXISTS "suppliers";
DROP VIEW IF EXISTS "customers";
DROP VIEW IF EXISTS "purchaseOrderLocations";

-- Remove taxId and vatNumber from customer and supplier tables
ALTER TABLE "customer" DROP COLUMN IF EXISTS "taxId";
ALTER TABLE "customer" DROP COLUMN IF EXISTS "vatNumber";
ALTER TABLE "supplier" DROP COLUMN IF EXISTS "taxId";
ALTER TABLE "supplier" DROP COLUMN IF EXISTS "vatNumber";

-- Recreate suppliers view (join taxId/vatNumber from supplierTax)
CREATE OR REPLACE VIEW "suppliers" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.id,
    s.name,
    s."supplierTypeId",
    s."supplierStatus" as "status",
    stx."taxId",
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
    stx."vatNumber",
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
  LEFT JOIN "supplierTax" stx ON stx."supplierId" = s.id
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

-- Recreate customers view (join taxId/vatNumber from customerTax)
CREATE OR REPLACE VIEW "customers" WITH(SECURITY_INVOKER=true) AS
  SELECT
    c.id,
    c.name,
    c."customerTypeId",
    c."customerStatusId",
    ctx."taxId",
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
    ctx."vatNumber",
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
  LEFT JOIN "customerTax" ctx ON ctx."customerId" = c.id
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

-- Recreate purchaseOrderLocations view (join taxId/vatNumber from supplierTax)
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
    stx."taxId" AS "supplierTaxId",
    stx."vatNumber" AS "supplierVatNumber",
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
  LEFT OUTER JOIN "supplierTax" stx
    ON stx."supplierId" = s.id
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

-- Update search index functions to look up taxId from tax tables
CREATE OR REPLACE FUNCTION sync_customer_to_search_index()
RETURNS TRIGGER AS $$
DECLARE
  v_table_name TEXT;
  v_cust_type TEXT;
  v_cust_status TEXT;
  v_tax_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_table_name := 'searchIndex_' || OLD."companyId";
    EXECUTE format('DELETE FROM %I WHERE "entityType" = $1 AND "entityId" = $2', v_table_name)
      USING 'customer', OLD.id;
    RETURN OLD;
  END IF;

  v_table_name := 'searchIndex_' || NEW."companyId";

  SELECT name INTO v_cust_type FROM "customerType" WHERE id = NEW."customerTypeId";
  SELECT name INTO v_cust_status FROM "customerStatus" WHERE id = NEW."customerStatusId";
  SELECT "taxId" INTO v_tax_id FROM "customerTax" WHERE "customerId" = NEW.id;

  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    VALUES ($1, $2, $3, $4, $5, $6, to_tsvector(''english'', $3 || '' '' || COALESCE(array_to_string($5, '' ''), '''')))
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = to_tsvector(''english'', EXCLUDED."title" || '' '' || COALESCE(array_to_string(EXCLUDED."tags", '' ''), '''')),
      "updatedAt" = NOW()
  ', v_table_name) USING
    'customer',
    NEW.id,
    NEW.name,
    '/x/customer/' || NEW.id,
    ARRAY_REMOVE(ARRAY[v_cust_type, v_cust_status], NULL),
    jsonb_build_object('taxId', v_tax_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION sync_supplier_to_search_index()
RETURNS TRIGGER AS $$
DECLARE
  v_table_name TEXT;
  v_supp_type TEXT;
  v_supp_status TEXT;
  v_tax_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_table_name := 'searchIndex_' || OLD."companyId";
    EXECUTE format('DELETE FROM %I WHERE "entityType" = $1 AND "entityId" = $2', v_table_name)
      USING 'supplier', OLD.id;
    RETURN OLD;
  END IF;

  v_table_name := 'searchIndex_' || NEW."companyId";

  SELECT name INTO v_supp_type FROM "supplierType" WHERE id = NEW."supplierTypeId";
  v_supp_status := NEW."supplierStatus"::TEXT;
  SELECT "taxId" INTO v_tax_id FROM "supplierTax" WHERE "supplierId" = NEW.id;

  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    VALUES ($1, $2, $3, $4, $5, $6, to_tsvector(''english'', $3 || '' '' || COALESCE(array_to_string($5, '' ''), '''')))
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = to_tsvector(''english'', EXCLUDED."title" || '' '' || COALESCE(array_to_string(EXCLUDED."tags", '' ''), '''')),
      "updatedAt" = NOW()
  ', v_table_name) USING
    'supplier',
    NEW.id,
    NEW.name,
    '/x/supplier/' || NEW.id,
    ARRAY_REMOVE(ARRAY[v_supp_type, v_supp_status], NULL),
    jsonb_build_object('taxId', v_tax_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update populate_company_search_index to join tax tables
CREATE OR REPLACE FUNCTION populate_company_search_index(p_company_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_table_name TEXT := 'searchIndex_' || p_company_id;
BEGIN
  -- Populate employees
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    SELECT
      ''employee'',
      e.id,
      COALESCE(u."fullName", ''''),
      ''/x/person/'' || e.id,
      ARRAY_REMOVE(ARRAY[et.name], NULL),
      jsonb_build_object(''active'', e.active),
      to_tsvector(''english'', COALESCE(u."fullName", '''') || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[et.name], NULL), '' ''), ''''))
    FROM "employee" e
    INNER JOIN "user" u ON u.id = e.id
    LEFT JOIN "employeeType" et ON et.id = e."employeeTypeId"
    WHERE e."companyId" = $1 AND e.active = true
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate customers (join customerTax for taxId)
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    SELECT
      ''customer'',
      c.id,
      c.name,
      ''/x/customer/'' || c.id,
      ARRAY_REMOVE(ARRAY[ct.name, cs.name], NULL),
      jsonb_build_object(''taxId'', ctx."taxId"),
      to_tsvector(''english'', c.name || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[ct.name, cs.name], NULL), '' ''), ''''))
    FROM "customer" c
    LEFT JOIN "customerTax" ctx ON ctx."customerId" = c.id
    LEFT JOIN "customerType" ct ON ct.id = c."customerTypeId"
    LEFT JOIN "customerStatus" cs ON cs.id = c."customerStatusId"
    WHERE c."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate suppliers (join supplierTax for taxId)
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    SELECT
      ''supplier'',
      s.id,
      s.name,
      ''/x/supplier/'' || s.id,
      ARRAY_REMOVE(ARRAY[st.name, s."supplierStatus"::TEXT], NULL),
      jsonb_build_object(''taxId'', stx."taxId"),
      to_tsvector(''english'', s.name || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[st.name, s."supplierStatus"::TEXT], NULL), '' ''), ''''))
    FROM "supplier" s
    LEFT JOIN "supplierTax" stx ON stx."supplierId" = s.id
    LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
    WHERE s."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach audit event triggers
SELECT attach_event_trigger('customerTax', ARRAY[]::TEXT[]);
SELECT attach_event_trigger('supplierTax', ARRAY[]::TEXT[]);
