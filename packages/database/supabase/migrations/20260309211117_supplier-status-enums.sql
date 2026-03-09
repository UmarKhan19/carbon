-- Migration: Convert supplier status from FK table to enum

-- Step 1: Create the enum type
CREATE TYPE "supplierStatusType" AS ENUM ('Active', 'Inactive', 'Pending', 'Rejected');

-- Step 2: Add new enum column (nullable)
ALTER TABLE "supplier" ADD COLUMN "supplierStatus" "supplierStatusType";

-- Step 3: Backfill from existing supplierStatus table (exact match only, otherwise null)
UPDATE "supplier" s
SET "supplierStatus" = ss.name::"supplierStatusType"
FROM "supplierStatus" ss
WHERE ss.id = s."supplierStatusId"
  AND ss.name IN ('Active', 'Inactive', 'Pending', 'Rejected');

-- Step 4: Drop the suppliers view (depends on supplierStatusId column)
DROP VIEW IF EXISTS "suppliers";

-- Step 5: Drop FK constraint and column
ALTER TABLE "supplier" DROP CONSTRAINT "supplier_supplierStatusId_fkey";
ALTER TABLE "supplier" DROP COLUMN "supplierStatusId";

-- Step 6: Drop RLS policies on supplierStatus table
DROP POLICY IF EXISTS "SELECT" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "INSERT" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "UPDATE" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "DELETE" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "Employees with purchasing_view can view supplier statuses" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "Employees with purchasing_create can create supplier statuses" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "Employees with purchasing_update can update supplier statuses" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete supplier statuses" ON "public"."supplierStatus";
DROP POLICY IF EXISTS "Requests with an API key can access supplier statuses" ON "public"."supplierStatus";

-- Step 6: Drop supplierStatus table
DROP TABLE IF EXISTS "supplierStatus";

-- Step 7: Recreate the suppliers view with enum column instead of FK join
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

-- Step 8: Update search trigger function for supplier
CREATE OR REPLACE FUNCTION sync_supplier_to_search_index()
RETURNS TRIGGER AS $$
DECLARE
  v_table_name TEXT;
  v_supp_type TEXT;
  v_supp_status TEXT;
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
    jsonb_build_object('taxId', NEW."taxId");

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 9: Update the populate_company_search_index function (supplier section)
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

  -- Populate customers
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    SELECT
      ''customer'',
      c.id,
      c.name,
      ''/x/customer/'' || c.id,
      ARRAY_REMOVE(ARRAY[ct.name, cs.name], NULL),
      jsonb_build_object(''taxId'', c."taxId"),
      to_tsvector(''english'', c.name || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[ct.name, cs.name], NULL), '' ''), ''''))
    FROM "customer" c
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

  -- Populate suppliers (uses enum column instead of FK join)
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    SELECT
      ''supplier'',
      s.id,
      s.name,
      ''/x/supplier/'' || s.id,
      ARRAY_REMOVE(ARRAY[st.name, s."supplierStatus"::TEXT], NULL),
      jsonb_build_object(''taxId'', s."taxId"),
      to_tsvector(''english'', s.name || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[st.name, s."supplierStatus"::TEXT], NULL), '' ''), ''''))
    FROM "supplier" s
    LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
    WHERE s."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate items
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "description", "link", "tags", "metadata", "searchVector")
    SELECT
      ''item'',
      i.id,
      i."readableId",
      i.name || '' '' || COALESCE(i.description, ''''),
      CASE i.type
        WHEN ''Part'' THEN ''/x/part/'' || i.id
        WHEN ''Service'' THEN ''/x/service/'' || i.id
        WHEN ''Tool'' THEN ''/x/tool/'' || i.id
        WHEN ''Consumable'' THEN ''/x/consumable/'' || i.id
        WHEN ''Material'' THEN ''/x/material/'' || i.id
        WHEN ''Fixture'' THEN ''/x/fixture/'' || i.id
        ELSE ''/x/part/'' || i.id
      END,
      ARRAY_REMOVE(ARRAY[i.type::TEXT, i."replenishmentSystem"::TEXT], NULL),
      jsonb_build_object(''active'', i.active),
      to_tsvector(''english'', i."readableId" || '' '' || i.name || '' '' || COALESCE(i.description, '''') || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[i.type::TEXT, i."replenishmentSystem"::TEXT], NULL), '' ''), ''''))
    FROM "item" i
    WHERE i."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "link" = EXCLUDED."link",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate jobs
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "description", "link", "tags", "metadata", "searchVector")
    SELECT
      ''job'',
      j.id,
      j."jobId",
      COALESCE(i.name, '''') || '' '' || COALESCE(c.name, ''''),
      ''/x/job/'' || j.id,
      ARRAY_REMOVE(ARRAY[j.status::TEXT, j."deadlineType"::TEXT], NULL),
      jsonb_build_object(''quantity'', j.quantity, ''dueDate'', j."dueDate"),
      to_tsvector(''english'', j."jobId" || '' '' || COALESCE(i.name, '''') || '' '' || COALESCE(c.name, '''') || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[j.status::TEXT, j."deadlineType"::TEXT], NULL), '' ''), ''''))
    FROM "job" j
    LEFT JOIN "item" i ON i.id = j."itemId"
    LEFT JOIN "customer" c ON c.id = j."customerId"
    WHERE j."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate purchase orders
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "description", "link", "tags", "metadata", "searchVector")
    SELECT
      ''purchaseOrder'',
      po.id,
      po."purchaseOrderId",
      COALESCE(s.name, ''''),
      ''/x/purchase-order/'' || po.id,
      ARRAY_REMOVE(ARRAY[po.status::TEXT], NULL),
      jsonb_build_object(''orderDate'', po."orderDate", ''supplierReference'', po."supplierReference"),
      to_tsvector(''english'', po."purchaseOrderId" || '' '' || COALESCE(s.name, '''') || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[po.status::TEXT], NULL), '' ''), ''''))
    FROM "purchaseOrder" po
    LEFT JOIN "supplier" s ON s.id = po."supplierId"
    WHERE po."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate sales invoices
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "description", "link", "tags", "metadata", "searchVector")
    SELECT
      ''salesInvoice'',
      si.id,
      si."invoiceId",
      COALESCE(c.name, ''''),
      ''/x/invoicing/sales/'' || si.id,
      ARRAY_REMOVE(ARRAY[si.status::TEXT], NULL),
      jsonb_build_object(''totalAmount'', si."totalAmount", ''dateDue'', si."dateDue"),
      to_tsvector(''english'', si."invoiceId" || '' '' || COALESCE(c.name, '''') || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[si.status::TEXT], NULL), '' ''), ''''))
    FROM "salesInvoice" si
    LEFT JOIN "customer" c ON c.id = si."customerId"
    WHERE si."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate purchase invoices
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "description", "link", "tags", "metadata", "searchVector")
    SELECT
      ''purchaseInvoice'',
      pi.id,
      pi."invoiceId",
      COALESCE(s.name, ''''),
      ''/x/invoicing/purchasing/'' || pi.id,
      ARRAY_REMOVE(ARRAY[pi.status::TEXT], NULL),
      jsonb_build_object(''totalAmount'', pi."totalAmount", ''dateDue'', pi."dateDue"),
      to_tsvector(''english'', pi."invoiceId" || '' '' || COALESCE(s.name, '''') || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[pi.status::TEXT], NULL), '' ''), ''''))
    FROM "purchaseInvoice" pi
    LEFT JOIN "supplier" s ON s.id = pi."supplierId"
    WHERE pi."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate non-conformances (issues)
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "description", "link", "tags", "metadata", "searchVector")
    SELECT
      ''issue'',
      nc.id,
      nc."nonConformanceId",
      nc.name || '' '' || COALESCE(nc.description, ''''),
      ''/x/issue/'' || nc.id,
      ARRAY_REMOVE(ARRAY[nc.status::TEXT, nc.priority::TEXT, nct.name], NULL),
      jsonb_build_object(''source'', nc.source, ''dueDate'', nc."dueDate"),
      to_tsvector(''english'', nc."nonConformanceId" || '' '' || nc.name || '' '' || COALESCE(nc.description, '''') || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[nc.status::TEXT, nc.priority::TEXT, nct.name], NULL), '' ''), ''''))
    FROM "nonConformance" nc
    LEFT JOIN "nonConformanceType" nct ON nct.id = nc."nonConformanceTypeId"
    WHERE nc."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate gauges
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "description", "link", "tags", "metadata", "searchVector")
    SELECT
      ''gauge'',
      g.id,
      g."gaugeId",
      COALESCE(g.description, '''') || '' '' || COALESCE(g."serialNumber", ''''),
      ''/x/quality/gauges/'' || g.id,
      ARRAY_REMOVE(ARRAY[g."gaugeStatus"::TEXT, g."gaugeCalibrationStatus"::TEXT, gt.name], NULL),
      jsonb_build_object(''nextCalibrationDate'', g."nextCalibrationDate", ''serialNumber'', g."serialNumber"),
      to_tsvector(''english'', g."gaugeId" || '' '' || COALESCE(g.description, '''') || '' '' || COALESCE(g."serialNumber", '''') || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[g."gaugeStatus"::TEXT, g."gaugeCalibrationStatus"::TEXT, gt.name], NULL), '' ''), ''''))
    FROM "gauge" g
    LEFT JOIN "gaugeType" gt ON gt.id = g."gaugeTypeId"
    WHERE g."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Update registry
  UPDATE "searchIndexRegistry"
  SET "lastRebuiltAt" = NOW()
  WHERE "companyId" = p_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
