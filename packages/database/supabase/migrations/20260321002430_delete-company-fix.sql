CREATE OR REPLACE FUNCTION protect_system_required_actions()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow cascading deletes when the parent company is being deleted
  IF TG_OP = 'DELETE' THEN
    IF OLD."systemType" IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM "company" WHERE id = OLD."companyId") THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Cannot delete a system-defined required action. You may deactivate it instead.';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."systemType" IS NOT NULL AND (NEW."systemType" IS DISTINCT FROM OLD."systemType") THEN
      RAISE EXCEPTION 'Cannot change the systemType of a system-defined required action.';
    END IF;
    IF OLD."systemType" IS NULL AND NEW."systemType" IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot assign a systemType to a custom required action.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Prevent sync_contact_to_parent from firing during cascade deletes
-- (the parent customer/supplier may already be gone)
CREATE OR REPLACE FUNCTION sync_contact_to_parent(
  table_name TEXT,
  operation TEXT,
  new_data JSONB,
  old_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  contact_id TEXT;
BEGIN
  IF operation = 'DELETE' THEN
    RETURN;
  END IF;

  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  contact_id := COALESCE(new_data->>'id', old_data->>'id');

  UPDATE "customer" c
  SET "updatedAt" = NOW()
  FROM "customerContact" cc
  WHERE cc."contactId" = contact_id
    AND cc."customerId" = c.id;

  UPDATE "supplier" s
  SET "updatedAt" = NOW()
  FROM "supplierContact" sc
  WHERE sc."contactId" = contact_id
    AND sc."supplierId" = s.id;
END;
$$;

-- Same fix for address sync
CREATE OR REPLACE FUNCTION sync_address_to_parent(
  table_name TEXT,
  operation TEXT,
  new_data JSONB,
  old_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  address_id TEXT;
BEGIN
  IF operation = 'DELETE' THEN
    RETURN;
  END IF;

  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  address_id := COALESCE(new_data->>'id', old_data->>'id');

  UPDATE "customer" c
  SET "updatedAt" = NOW()
  FROM "customerLocation" cl
  WHERE cl."addressId" = address_id
    AND cl."customerId" = c.id;

  UPDATE "supplier" s
  SET "updatedAt" = NOW()
  FROM "supplierLocation" sl
  WHERE sl."addressId" = address_id
    AND sl."supplierId" = s.id;
END;
$$;

-- Add missing ON DELETE CASCADE for material tables
ALTER TABLE "materialFinish" DROP CONSTRAINT "materialFinish_companyId_fkey",
  ADD CONSTRAINT "materialFinish_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "materialGrade" DROP CONSTRAINT "materialGrade_companyId_fkey",
  ADD CONSTRAINT "materialGrade_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "materialType" DROP CONSTRAINT "materialType_companyId_fkey",
  ADD CONSTRAINT "materialType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "materialDimension" DROP CONSTRAINT "materialDimensions_companyId_fkey",
  ADD CONSTRAINT "materialDimensions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allow cascade deletes for invoice protection triggers
CREATE OR REPLACE FUNCTION prevent_posted_purchase_invoice_deletion(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_operation = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "company" WHERE id = (p_old->>'companyId')) THEN
      RETURN;
    END IF;
    IF p_old->>'status' IS DISTINCT FROM 'Draft' THEN
      RAISE EXCEPTION 'Cannot delete purchase invoice with status "%". Only Draft invoices can be deleted.', p_old->>'status';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_posted_sales_invoice_deletion(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_operation = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "company" WHERE id = (p_old->>'companyId')) THEN
      RETURN;
    END IF;
    IF p_old->>'status' IS DISTINCT FROM 'Draft' THEN
      RAISE EXCEPTION 'Cannot delete sales invoice with status "%". Only Draft invoices can be deleted.', p_old->>'status';
    END IF;
  END IF;
END;
$$;
