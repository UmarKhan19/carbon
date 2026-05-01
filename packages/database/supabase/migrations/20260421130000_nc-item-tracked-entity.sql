-- Per-disposition-row tracked entity link.
--
-- Lets MRB allocate specific serials/batches to individual nonConformanceItem
-- rows so that closure (ledger post + entity status flip) can be done per
-- portion. Enforces: a given entity appears on at most one disposition row
-- per non-conformance.

CREATE TABLE "nonConformanceItemTrackedEntity" (
  "id" TEXT NOT NULL DEFAULT id(),
  "nonConformanceItemId" TEXT NOT NULL,
  "nonConformanceId" TEXT NOT NULL,
  "trackedEntityId" TEXT NOT NULL,
  "quantity" NUMERIC(12, 4) NOT NULL DEFAULT 1,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceItemTrackedEntity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nciTrackedEntity_nonConformanceItemId_fkey"
    FOREIGN KEY ("nonConformanceItemId") REFERENCES "nonConformanceItem"("id") ON DELETE CASCADE,
  CONSTRAINT "nciTrackedEntity_nonConformanceId_fkey"
    FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE,
  CONSTRAINT "nciTrackedEntity_trackedEntityId_fkey"
    FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id") ON DELETE RESTRICT,
  CONSTRAINT "nciTrackedEntity_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "nciTrackedEntity_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nciTrackedEntity_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE,

  CONSTRAINT "nciTrackedEntity_rowUnique"
    UNIQUE ("nonConformanceItemId", "trackedEntityId"),
  CONSTRAINT "nciTrackedEntity_ncUnique"
    UNIQUE ("nonConformanceId", "trackedEntityId"),

  CONSTRAINT "nciTrackedEntity_quantity_positive" CHECK ("quantity" > 0)
);

CREATE INDEX "nciTrackedEntity_nonConformanceItemId_idx"
  ON "nonConformanceItemTrackedEntity" ("nonConformanceItemId");
CREATE INDEX "nciTrackedEntity_trackedEntityId_idx"
  ON "nonConformanceItemTrackedEntity" ("trackedEntityId");
CREATE INDEX "nciTrackedEntity_nonConformanceId_idx"
  ON "nonConformanceItemTrackedEntity" ("nonConformanceId");

-- Keep the denormalized nonConformanceId in sync with the parent row so the
-- ncUnique constraint stays declarative and app code doesn't need to
-- populate it.
CREATE OR REPLACE FUNCTION set_nci_tracked_entity_non_conformance_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT "nonConformanceId" INTO NEW."nonConformanceId"
  FROM "nonConformanceItem"
  WHERE "id" = NEW."nonConformanceItemId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_nci_tracked_entity_non_conformance_id_trigger
  ON "nonConformanceItemTrackedEntity";
CREATE TRIGGER set_nci_tracked_entity_non_conformance_id_trigger
  BEFORE INSERT OR UPDATE OF "nonConformanceItemId"
  ON "nonConformanceItemTrackedEntity"
  FOR EACH ROW
  EXECUTE FUNCTION set_nci_tracked_entity_non_conformance_id();

ALTER TABLE "nonConformanceItemTrackedEntity" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."nonConformanceItemTrackedEntity"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceItemTrackedEntity"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceItemTrackedEntity"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceItemTrackedEntity"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

-- Best-effort backfill: seed join rows for existing NCs that already have
-- nonConformanceTrackedEntity links. For NCs with a single disposition row,
-- assign the full row quantity to the linked entity; otherwise default to 1
-- (serial convention). NCs with multiple rows and multiple entities cannot
-- be backfilled unambiguously — those will need manual re-linking.
INSERT INTO "nonConformanceItemTrackedEntity" (
  "nonConformanceItemId",
  "nonConformanceId",
  "trackedEntityId",
  "quantity",
  "companyId",
  "createdBy"
)
SELECT
  nci."id",
  nci."nonConformanceId",
  nte."trackedEntityId",
  CASE
    WHEN (SELECT COUNT(*)
          FROM "nonConformanceItem" sibling
          WHERE sibling."nonConformanceId" = nci."nonConformanceId") = 1
    THEN COALESCE(nci."quantity", 1)
    ELSE 1
  END,
  nci."companyId",
  nci."createdBy"
FROM "nonConformanceItem" nci
JOIN "nonConformanceTrackedEntity" nte
  ON nte."nonConformanceId" = nci."nonConformanceId"
WHERE COALESCE(nci."quantity", 0) > 0
ON CONFLICT DO NOTHING;
