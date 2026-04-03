-- NVENTORY-002: Shelf Life Management
-- Adds shelf life configuration, storage types, label types,
-- tracked entity expiration/manufacturing dates, and FEFO support.

-- ============================================================================
-- 1. User-Defined Reference Tables
-- ============================================================================

-- Storage types (e.g., Ambient, Refrigerated 0-4°C, Frozen -18°C, Controlled Room Temp)
CREATE TABLE "storageType" (
  "id" TEXT NOT NULL DEFAULT id('st'),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "companyId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "storageType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storageType_name_unique" UNIQUE ("name", "companyId"),
  CONSTRAINT "storageType_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "storageType_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "storageType_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "storageType_companyId_idx" ON "storageType"("companyId");

ALTER TABLE "storageType" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."storageType"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."storageType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."storageType"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."storageType"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);

-- Shelf life label types (e.g., "Best Before", "Use By", "Expiry Date")
CREATE TABLE "shelfLifeLabelType" (
  "id" TEXT NOT NULL DEFAULT id('sllt'),
  "name" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "shelfLifeLabelType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shelfLifeLabelType_name_unique" UNIQUE ("name", "companyId"),
  CONSTRAINT "shelfLifeLabelType_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "shelfLifeLabelType_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "shelfLifeLabelType_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE INDEX "shelfLifeLabelType_companyId_idx" ON "shelfLifeLabelType"("companyId");

ALTER TABLE "shelfLifeLabelType" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."shelfLifeLabelType"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."shelfLifeLabelType"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."shelfLifeLabelType"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."shelfLifeLabelType"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);


-- ============================================================================
-- 2. Item Shelf Life Configuration (1:1 with item)
-- ============================================================================

CREATE TABLE "itemShelfLife" (
  "itemId" TEXT NOT NULL,
  "totalShelfLifeDays" INTEGER NOT NULL,
  "commercialShelfLifeDays" INTEGER,
  "minRemainingShelfLifeDays" INTEGER,
  "storageTypeId" TEXT,
  "shelfLifeLabelTypeId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "itemShelfLife_pkey" PRIMARY KEY ("itemId"),
  CONSTRAINT "itemShelfLife_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemShelfLife_storageTypeId_fkey"
    FOREIGN KEY ("storageTypeId") REFERENCES "storageType"("id") ON DELETE SET NULL,
  CONSTRAINT "itemShelfLife_shelfLifeLabelTypeId_fkey"
    FOREIGN KEY ("shelfLifeLabelTypeId") REFERENCES "shelfLifeLabelType"("id") ON DELETE SET NULL,
  CONSTRAINT "itemShelfLife_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "itemShelfLife_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "itemShelfLife_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "itemShelfLife_totalShelfLifeDays_check"
    CHECK ("totalShelfLifeDays" > 0),
  CONSTRAINT "itemShelfLife_commercial_check"
    CHECK ("commercialShelfLifeDays" IS NULL OR "commercialShelfLifeDays" <= "totalShelfLifeDays"),
  CONSTRAINT "itemShelfLife_min_remaining_check"
    CHECK ("minRemainingShelfLifeDays" IS NULL OR "minRemainingShelfLifeDays" <= "totalShelfLifeDays")
);

CREATE INDEX "itemShelfLife_companyId_idx" ON "itemShelfLife"("companyId");
CREATE INDEX "itemShelfLife_storageTypeId_idx" ON "itemShelfLife"("storageTypeId");

ALTER TABLE "itemShelfLife" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."itemShelfLife"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."itemShelfLife"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."itemShelfLife"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."itemShelfLife"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
  )
);


-- ============================================================================
-- 3. Tracked Entity: Top-Level Expiration & Manufacturing Date Columns
-- ============================================================================

ALTER TABLE "trackedEntity" ADD COLUMN "expirationDate" DATE;
ALTER TABLE "trackedEntity" ADD COLUMN "manufacturingDate" DATE;

-- Partial index for FEFO queries: only available entities with expiration dates
CREATE INDEX "trackedEntity_expirationDate_idx"
  ON "trackedEntity" ("expirationDate" ASC NULLS LAST)
  WHERE "expirationDate" IS NOT NULL AND "status" = 'Available';


-- ============================================================================
-- 4. Shelf: Storage Type Assignment
-- ============================================================================

ALTER TABLE "shelf" ADD COLUMN "storageTypeId" TEXT
  REFERENCES "storageType"("id") ON DELETE SET NULL;

-- Notification group for near-expiry alerts (array of userId strings to notify)
ALTER TABLE "companySettings"
  ADD COLUMN "shelfLifeExpiryNotificationGroup" TEXT[] NOT NULL DEFAULT '{}';


-- ============================================================================
-- 5. SQL Helper Functions
-- ============================================================================

-- Calculate expiration date from item shelf life config and a packaging/production date
CREATE OR REPLACE FUNCTION calculate_expiration_date(
  p_item_id TEXT,
  p_packaging_date DATE
) RETURNS DATE AS $$
DECLARE
  v_total_shelf_life_days INTEGER;
BEGIN
  SELECT "totalShelfLifeDays" INTO v_total_shelf_life_days
  FROM "itemShelfLife"
  WHERE "itemId" = p_item_id;

  IF v_total_shelf_life_days IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN p_packaging_date + v_total_shelf_life_days;
END;
$$ LANGUAGE plpgsql STABLE;


-- Validate commercial shelf life: checks item-level default.
-- Returns TRUE if remaining shelf life is sufficient, FALSE if not.
CREATE OR REPLACE FUNCTION validate_commercial_shelf_life(
  p_item_id TEXT,
  p_expiration_date DATE,
  p_ship_date DATE
) RETURNS BOOLEAN AS $$
DECLARE
  v_commercial_days INTEGER;
  v_remaining_days INTEGER;
BEGIN
  -- If no expiration date, cannot validate -- allow
  IF p_expiration_date IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT "commercialShelfLifeDays" INTO v_commercial_days
  FROM "itemShelfLife"
  WHERE "itemId" = p_item_id;

  -- If no commercial shelf life configured, always valid
  IF v_commercial_days IS NULL THEN
    RETURN TRUE;
  END IF;

  v_remaining_days := p_expiration_date - p_ship_date;
  RETURN v_remaining_days >= v_commercial_days;
END;
$$ LANGUAGE plpgsql STABLE;


-- Validate minimum remaining shelf life at goods receipt.
-- Returns TRUE if remaining shelf life is sufficient, FALSE if goods should be rejected.
CREATE OR REPLACE FUNCTION validate_min_remaining_shelf_life(
  p_item_id TEXT,
  p_expiration_date DATE,
  p_receipt_date DATE
) RETURNS BOOLEAN AS $$
DECLARE
  v_min_remaining_days INTEGER;
  v_remaining_days INTEGER;
BEGIN
  -- If no expiration date, cannot validate -- allow
  IF p_expiration_date IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT "minRemainingShelfLifeDays" INTO v_min_remaining_days
  FROM "itemShelfLife"
  WHERE "itemId" = p_item_id;

  -- If no minimum remaining shelf life configured, always valid
  IF v_min_remaining_days IS NULL THEN
    RETURN TRUE;
  END IF;

  v_remaining_days := p_expiration_date - p_receipt_date;
  RETURN v_remaining_days >= v_min_remaining_days;
END;
$$ LANGUAGE plpgsql STABLE;


-- Get tracked entities for FEFO picking: ordered by earliest expiration date.
-- Returns available entities for an item at a location.
CREATE OR REPLACE FUNCTION get_fefo_tracked_entities(
  p_item_id TEXT,
  p_company_id TEXT,
  p_location_id TEXT DEFAULT NULL
) RETURNS TABLE (
  "trackedEntityId" TEXT,
  "quantity" NUMERIC,
  "expirationDate" DATE,
  "manufacturingDate" DATE,
  "readableId" TEXT,
  "status" TEXT,
  "attributes" JSONB,
  "shelfId" TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    il."trackedEntityId",
    SUM(il."quantity") AS "quantity",
    te."expirationDate",
    te."manufacturingDate",
    te."readableId",
    te."status"::TEXT,
    te."attributes",
    il."shelfId"
  FROM "itemLedger" il
  INNER JOIN "trackedEntity" te ON te."id" = il."trackedEntityId"
  WHERE il."itemId" = p_item_id
    AND il."companyId" = p_company_id
    AND (p_location_id IS NULL OR il."locationId" = p_location_id)
    AND te."status" = 'Available'
  GROUP BY
    il."trackedEntityId",
    te."expirationDate",
    te."manufacturingDate",
    te."readableId",
    te."status",
    te."attributes",
    il."shelfId"
  HAVING SUM(il."quantity") > 0
  ORDER BY
    te."expirationDate" ASC NULLS LAST,
    te."createdAt" ASC;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
