-- ============================================================
-- P3 — Production Incidents
--
-- Records discrepancies that happen during production: equipment
-- failure, crop disease, contamination, etc. When the incident has
-- impactsPickingList = true, a trigger reduces matching active PL
-- line estimated quantities via the existing adjustedQuantity column
-- so the operator no longer sees the lost stock as a shortage.
-- ============================================================

CREATE TYPE "productionIncidentStatus" AS ENUM ('Open', 'Resolved', 'Closed');

CREATE TABLE "productionIncidentType" (
  "id"          TEXT        NOT NULL DEFAULT id('pit'),
  "name"        TEXT        NOT NULL,
  "companyId"   TEXT        NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdBy"   TEXT        NOT NULL,
  "updatedAt"   TIMESTAMPTZ,
  "updatedBy"   TEXT,
  CONSTRAINT "productionIncidentType_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "productionIncidentType_name_companyId_key"
    UNIQUE ("name", "companyId"),
  CONSTRAINT "productionIncidentType_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id")
    ON DELETE CASCADE,
  CONSTRAINT "productionIncidentType_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id")
    ON DELETE RESTRICT,
  CONSTRAINT "productionIncidentType_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
    ON DELETE RESTRICT
);

ALTER TABLE "productionIncidentType" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "productionIncidentType_select"
ON "productionIncidentType"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "productionIncidentType_modify"
ON "productionIncidentType"
FOR ALL USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

-- Seed default types per company. Trigger fires when a userToCompany row
-- with role='employee' is inserted (i.e. the first employee linked to a
-- company), so the company's first employee owns the seeded types.
-- ON CONFLICT DO NOTHING keeps it idempotent across employee additions.
CREATE OR REPLACE FUNCTION seed_production_incident_types_for_company()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW."role" <> 'employee' THEN RETURN NEW; END IF;
  INSERT INTO "productionIncidentType" ("name", "companyId", "createdBy")
  VALUES
    ('Equipment Failure',     NEW."companyId", NEW."userId"),
    ('Crop Disease',          NEW."companyId", NEW."userId"),
    ('Environmental Damage',  NEW."companyId", NEW."userId"),
    ('Quality Rejection',     NEW."companyId", NEW."userId"),
    ('Pest Damage',           NEW."companyId", NEW."userId"),
    ('Contamination',         NEW."companyId", NEW."userId"),
    ('Other',                 NEW."companyId", NEW."userId")
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- ─── productionIncident ─────────────────────────────────────

CREATE TABLE "productionIncident" (
  "id"                   TEXT        NOT NULL DEFAULT id('pi'),
  "incidentId"           TEXT,
  "jobId"                TEXT        NOT NULL,
  "itemId"               TEXT,
  "trackedEntityId"      TEXT,
  "incidentDate"         DATE        NOT NULL DEFAULT CURRENT_DATE,
  "incidentTypeId"       TEXT,
  "quantityLost"         NUMERIC(12,4) NOT NULL DEFAULT 0,
  "position"             TEXT,
  "impactsPickingList"   BOOLEAN     NOT NULL DEFAULT false,
  "status"               "productionIncidentStatus" NOT NULL DEFAULT 'Open',
  "notes"                JSONB,
  "customFields"         JSONB,
  "companyId"            TEXT        NOT NULL,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdBy"            TEXT        NOT NULL,
  "updatedAt"            TIMESTAMPTZ,
  "updatedBy"            TEXT,

  CONSTRAINT "productionIncident_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "productionIncident_incidentId_companyId_key"
    UNIQUE ("incidentId", "companyId"),
  CONSTRAINT "productionIncident_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "productionIncident_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL,
  CONSTRAINT "productionIncident_trackedEntityId_fkey"
    FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id")
    ON DELETE SET NULL,
  CONSTRAINT "productionIncident_incidentTypeId_fkey"
    FOREIGN KEY ("incidentTypeId") REFERENCES "productionIncidentType"("id")
    ON DELETE SET NULL,
  CONSTRAINT "productionIncident_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "productionIncident_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "productionIncident_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

CREATE INDEX "productionIncident_jobId_idx"
  ON "productionIncident" ("jobId");
CREATE INDEX "productionIncident_companyId_status_idx"
  ON "productionIncident" ("companyId", "status");

ALTER TABLE "productionIncident" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "productionIncident_select"
ON "productionIncident"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

CREATE POLICY "productionIncident_modify"
ON "productionIncident"
FOR ALL USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);

-- ─── Sequence for human-readable incidentId ─────────────────

INSERT INTO "sequence" ("table", "name", "prefix", "next", "size", "step", "companyId")
SELECT
  'productionIncident',
  'Production Incident',
  'INC',
  1,
  5,
  1,
  c.id
FROM "company" c
ON CONFLICT DO NOTHING;

-- ─── auto-adjust active PL lines on incident insert ─────────
--
-- When impactsPickingList = true, find every active (non-Confirmed,
-- non-Cancelled) PL line for this job that matches itemId (and
-- trackedEntityId if set), and reduce its adjustedQuantity by
-- quantityLost. Caps at zero — never go negative.
--
-- adjustedQuantity is set against the original estimatedQuantity to
-- preserve the snapshot. outstandingQuantity recomputes via the
-- existing GENERATED column expression
-- (GREATEST(COALESCE(adjustedQuantity, estimatedQuantity) - pickedQuantity, 0)).

CREATE OR REPLACE FUNCTION trigger_apply_incident_to_picking_lists()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT NEW."impactsPickingList" THEN
    RETURN NEW;
  END IF;
  IF NEW."quantityLost" IS NULL OR NEW."quantityLost" <= 0 THEN
    RETURN NEW;
  END IF;

  UPDATE "pickingListLine" pll
  SET "adjustedQuantity" = GREATEST(
        COALESCE(pll."adjustedQuantity", pll."estimatedQuantity")
          - NEW."quantityLost",
        0
      ),
      "updatedBy" = NEW."createdBy",
      "updatedAt" = NOW()
  FROM "pickingList" pl
  WHERE pll."pickingListId" = pl.id
    AND pl."jobId" = NEW."jobId"
    AND pl."companyId" = NEW."companyId"
    AND pl."status" NOT IN ('Confirmed', 'Cancelled')
    AND (NEW."itemId" IS NULL OR pll."itemId" = NEW."itemId")
    AND (
      NEW."trackedEntityId" IS NULL
      OR pll."pickedTrackedEntityId" = NEW."trackedEntityId"
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "productionIncident_apply_to_picking_lists"
  ON "productionIncident";
CREATE TRIGGER "productionIncident_apply_to_picking_lists"
AFTER INSERT ON "productionIncident"
FOR EACH ROW
EXECUTE FUNCTION trigger_apply_incident_to_picking_lists();

-- Retroactive seed for any companies that already have at least one
-- employee. Picks an arbitrary employee per company as the createdBy.
WITH first_employee AS (
  SELECT DISTINCT ON ("companyId") "companyId", "userId"
  FROM "userToCompany"
  WHERE "role" = 'employee'
  ORDER BY "companyId", "userId"
)
INSERT INTO "productionIncidentType" ("name", "companyId", "createdBy")
SELECT t.name, fe."companyId", fe."userId"
FROM first_employee fe
CROSS JOIN (VALUES
  ('Equipment Failure'),
  ('Crop Disease'),
  ('Environmental Damage'),
  ('Quality Rejection'),
  ('Pest Damage'),
  ('Contamination'),
  ('Other')
) AS t(name)
ON CONFLICT DO NOTHING;

-- Hook seed onto userToCompany so future first-employees seed types too.
DROP TRIGGER IF EXISTS "userToCompany_seed_production_incident_types"
  ON "userToCompany";
CREATE TRIGGER "userToCompany_seed_production_incident_types"
AFTER INSERT ON "userToCompany"
FOR EACH ROW
EXECUTE FUNCTION seed_production_incident_types_for_company();
