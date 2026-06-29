-- =============================================================================
-- PLM — Phase 2 (engineering-change support columns)
--   - methodMaterial: BOM line reference designators + item (find) number
--   - item.productManager: nullable FK -> "user" (ON DELETE SET NULL)
--   - group.isApprovalGroup: flag for approver-group filtering
--   - get_part_details: surface "productManager"
--
-- The Duro surface (category / categoryAttribute / categoryType enum / CPN /
-- plmActivity / companySettings.plmCpn*) has been dropped from this migration;
-- the change-order flow is item-native.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. methodMaterial — BOM line reference designators + item (find) number
--    Additive and nullable; existing RLS on "methodMaterial" covers them.
-- -----------------------------------------------------------------------------
ALTER TABLE "methodMaterial" ADD COLUMN "referenceDesignators" TEXT;
ALTER TABLE "methodMaterial" ADD COLUMN "itemNumber" TEXT;

-- -----------------------------------------------------------------------------
-- 2. item.productManager — nullable FK -> "user"
--    Additive and nullable; clears to NULL if the user is deleted; existing RLS
--    on "item" covers the new column.
-- -----------------------------------------------------------------------------
ALTER TABLE "item" ADD COLUMN "productManager" TEXT;

ALTER TABLE "item"
  ADD CONSTRAINT "item_productManager_fkey" FOREIGN KEY ("productManager") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "item_productManager_idx" ON "item" ("productManager") WHERE "productManager" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. group.isApprovalGroup — flag groups usable as change-order approver groups
-- -----------------------------------------------------------------------------
ALTER TABLE "group" ADD COLUMN "isApprovalGroup" BOOLEAN NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- 4. get_part_details — surface "productManager"
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_part_details(TEXT);
CREATE OR REPLACE FUNCTION get_part_details(item_id TEXT)
RETURNS TABLE (
    "active" BOOLEAN,
    "assignee" TEXT,
    "defaultMethodType" "methodType",
    "description" TEXT,
    "itemTrackingType" "itemTrackingType",
    "requiresInspection" BOOLEAN,
    "name" TEXT,
    "replenishmentSystem" "itemReplenishmentSystem",
    "unitOfMeasureCode" TEXT,
    "notes" JSONB,
    "thumbnailPath" TEXT,
    "modelId" TEXT,
    "modelPath" TEXT,
    "modelName" TEXT,
    "modelSize" BIGINT,
    "id" TEXT,
    "companyId" TEXT,
    "unitOfMeasure" TEXT,
    "readableId" TEXT,
    "revision" TEXT,
    "readableIdWithRevision" TEXT,
    "revisions" JSON,
    "customFields" JSONB,
    "tags" TEXT[],
    "itemPostingGroupId" TEXT,
    "productManager" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_readable_id TEXT;
  v_company_id TEXT;
BEGIN
  SELECT i."readableId", i."companyId" INTO v_readable_id, v_company_id
  FROM "item" i
  WHERE i.id = item_id;

  RETURN QUERY
  WITH item_revisions AS (
    SELECT
      json_agg(
        json_build_object(
          'id', i.id,
          'revision', i."revision",
          'methodType', i."defaultMethodType",
          'type', i."type"
        ) ORDER BY
          i."createdAt" DESC
      ) as "revisions"
    FROM "item" i
    WHERE i."readableId" = v_readable_id
    AND i."companyId" = v_company_id
  )
  SELECT
    i."active",
    i."assignee",
    i."defaultMethodType",
    i."description",
    i."itemTrackingType",
    i."requiresInspection",
    i."name",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    i."notes",
    CASE
      WHEN i."thumbnailPath" IS NULL AND mu."thumbnailPath" IS NOT NULL THEN mu."thumbnailPath"
      ELSE i."thumbnailPath"
    END as "thumbnailPath",
    mu.id as "modelId",
    mu."modelPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    i."id",
    i."companyId",
    uom.name as "unitOfMeasure",
    i."readableId",
    i."revision",
    i."readableIdWithRevision",
    ir."revisions",
    p."customFields",
    p."tags",
    ic."itemPostingGroupId",
    i."productManager",
    i."createdBy",
    i."createdAt",
    i."updatedBy",
    i."updatedAt"
  FROM "part" p
  LEFT JOIN "item" i ON i."readableId" = p."id" AND i."companyId" = p."companyId"
  LEFT JOIN item_revisions ir ON true
  LEFT JOIN (
    SELECT
      ps."itemId",
      string_agg(ps."supplierPartId", ',') AS "supplierIds"
    FROM "supplierPart" ps
    GROUP BY ps."itemId"
  ) ps ON ps."itemId" = i.id
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id
  WHERE i."id" = item_id;
END;
$$ LANGUAGE plpgsql;
