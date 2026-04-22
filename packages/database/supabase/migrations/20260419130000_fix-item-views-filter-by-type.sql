-- Fix cross-type leakage in the parts / materials / tools / consumables / services views.
--
-- Root cause: each view's `latest_items` and `item_revisions` CTEs scan the
-- entire "item" table and DISTINCT ON / GROUP BY (readableId, companyId)
-- without filtering by item type. Because the uniqueness constraint on "item"
-- is (readableId, companyId, type), a Part and a Tool can legitimately share
-- the same readable id within a company. When that happens, DISTINCT ON picks
-- whichever row has the latest revision/createdAt regardless of type, and the
-- outer join `INNER JOIN latest_items li ON li."readableId" = <table>."id"`
-- (which joins by readable id, not itemId) ends up returning the wrong item's
-- name, description, thumbnail, etc. alongside the real part row's
-- customFields/tags. This is why a Tool shows up on /x/items/parts.
--
-- Fix: add WHERE i."type" = '<Type>' to both CTEs in each view so each view
-- only considers items of its own type. Join keys are left unchanged to keep
-- the diff minimal; switching to li."id" = <table>."itemId" is a sensible
-- follow-up but not required to stop the bug.
--
-- The fixtures view already joins on i.id = f."itemId" and does not use the
-- latest_items CTE, so it is not affected.

-- =============================================================================
-- parts
-- =============================================================================
CREATE OR REPLACE VIEW "parts" WITH (SECURITY_INVOKER=true) AS
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId")
    i.*,
    mu.id as "modelUploadId",

    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  WHERE i."type" = 'Part'
  ORDER BY i."readableId", i."companyId",
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'name', i."name",
        'description', i."description",
        'active', i."active",
        'createdAt', i."createdAt"
      ) ORDER BY
        CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
        i."createdAt"
      ) as "revisions"
  FROM "item" i
  WHERE i."type" = 'Part'
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",

  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  p."customFields",
  p."tags",
  ic."itemPostingGroupId",
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
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "part" p
INNER JOIN latest_items li ON li."readableId" = p."id" AND li."companyId" = p."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = p."id" AND ir."companyId" = p."companyId"
LEFT JOIN (
  SELECT
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;


-- =============================================================================
-- materials
-- =============================================================================
CREATE OR REPLACE VIEW "materials" WITH (SECURITY_INVOKER=true) AS
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId")
    i.*,

    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  WHERE i."type" = 'Material'
  ORDER BY i."readableId", i."companyId",
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY
        CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
        i."createdAt"
      ) as "revisions"
  FROM "item" i
  WHERE i."type" = 'Material'
  GROUP BY i."readableId", i."companyId"
)
SELECT
  i."active",
  i."assignee",
  i."defaultMethodType",
  i."description",
  i."itemTrackingType",
  i."name",
  i."replenishmentSystem",
  i."unitOfMeasureCode",
  i."notes",
  i."revision",
  i."readableId",
  i."readableIdWithRevision",
  i."id",
  i."companyId",
  CASE
    WHEN i."thumbnailPath" IS NULL AND i."modelThumbnailPath" IS NOT NULL THEN i."modelThumbnailPath"
    ELSE i."thumbnailPath"
  END as "thumbnailPath",
  i."modelUploadId",
  i."modelPath",
  i."modelName",
  i."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  mf."name" AS "materialForm",
  ms."name" AS "materialSubstance",
  md."name" AS "dimensions",
  mfin."name" AS "finish",
  mg."name" AS "grade",
  mt."name" AS "materialType",
  m."materialSubstanceId",
  m."materialFormId",
  m."customFields",
  m."tags",
  ic."itemPostingGroupId",
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
    WHERE eim."entityType" = 'item' AND eim."entityId" = i.id
  ) AS "externalId",
  i."createdBy",
  i."createdAt",
  i."updatedBy",
  i."updatedAt"
FROM "material" m
  INNER JOIN latest_items i ON i."readableId" = m."id" AND i."companyId" = m."companyId"
  LEFT JOIN item_revisions ir ON ir."readableId" = m."id" AND ir."companyId" = i."companyId"
  LEFT JOIN (
    SELECT
      ps."itemId",
      ps."companyId",
      string_agg(ps."supplierPartId", ',') AS "supplierIds"
    FROM "supplierPart" ps
    GROUP BY ps."itemId", ps."companyId"
  ) ps ON ps."itemId" = i."id" AND ps."companyId" = i."companyId"
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  LEFT JOIN "unitOfMeasure" uom ON uom.code = i."unitOfMeasureCode" AND uom."companyId" = i."companyId"
  LEFT JOIN "materialForm" mf ON mf."id" = m."materialFormId"
  LEFT JOIN "materialSubstance" ms ON ms."id" = m."materialSubstanceId"
  LEFT JOIN "materialDimension" md ON m."dimensionId" = md."id"
  LEFT JOIN "materialFinish" mfin ON m."finishId" = mfin."id"
  LEFT JOIN "materialGrade" mg ON m."gradeId" = mg."id"
  LEFT JOIN "materialType" mt ON m."materialTypeId" = mt."id"
  LEFT JOIN "itemCost" ic ON ic."itemId" = i.id;


-- =============================================================================
-- tools
-- =============================================================================
CREATE OR REPLACE VIEW "tools" WITH (SECURITY_INVOKER=true) AS
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId")
    i.*,
    mu.id as "modelUploadId",

    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  WHERE i."type" = 'Tool'
  ORDER BY i."readableId", i."companyId",
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY
        CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
        i."createdAt"
      ) as "revisions"
  FROM "item" i
  WHERE i."type" = 'Tool'
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",

  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  t."customFields",
  t."tags",
  ic."itemPostingGroupId",
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
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "tool" t
  INNER JOIN latest_items li ON li."readableId" = t."id" AND li."companyId" = t."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = t."id" AND ir."companyId" = li."companyId"
LEFT JOIN (
  SELECT
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;


-- =============================================================================
-- consumables
-- =============================================================================
CREATE OR REPLACE VIEW "consumables" WITH (SECURITY_INVOKER=true) AS
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId")
    i.*,
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  WHERE i."type" = 'Consumable'
  ORDER BY i."readableId", i."companyId",
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY
        CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
        i."createdAt"
      ) as "revisions"
  FROM "item" i
  WHERE i."type" = 'Consumable'
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  CASE
    WHEN li."thumbnailPath" IS NULL AND li."modelThumbnailPath" IS NOT NULL THEN li."modelThumbnailPath"
    ELSE li."thumbnailPath"
  END as "thumbnailPath",
  li."modelUploadId",
  li."modelPath",
  li."modelName",
  li."modelSize",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  c."customFields",
  c."tags",
  ic."itemPostingGroupId",
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
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "consumable" c
  INNER JOIN latest_items li ON li."readableId" = c."id" AND li."companyId" = c."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = c."id" AND ir."companyId" = li."companyId"
LEFT JOIN (
  SELECT
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;


-- =============================================================================
-- services
-- =============================================================================
CREATE OR REPLACE VIEW "services" WITH(SECURITY_INVOKER=true) AS
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId", i."companyId")
    i.*
  FROM "item" i
  WHERE i."type" = 'Service'
  ORDER BY i."readableId", i."companyId",
    CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END DESC,
    i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT
    i."readableId",
    i."companyId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'methodType', i."defaultMethodType",
        'type', i."type"
      ) ORDER BY
        CASE WHEN i."revision" = '0' OR i."revision" = '' OR i."revision" IS NULL THEN 0 ELSE 1 END,
        i."createdAt"
      ) as "revisions"
  FROM "item" i
  WHERE i."type" = 'Service'
  GROUP BY i."readableId", i."companyId"
)
SELECT
  li."active",
  li."assignee",
  li."defaultMethodType",
  li."description",
  li."itemTrackingType",
  li."name",
  li."replenishmentSystem",
  li."unitOfMeasureCode",
  li."notes",
  li."revision",
  li."readableId",
  li."readableIdWithRevision",
  li."id",
  li."companyId",
  li."thumbnailPath",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  s."customFields",
  s."tags",
  ic."itemPostingGroupId",
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
    WHERE eim."entityType" = 'item' AND eim."entityId" = li.id
  ) AS "externalId",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "service" s
  INNER JOIN latest_items li ON li."readableId" = s."id" AND li."companyId" = s."companyId"
LEFT JOIN item_revisions ir ON ir."readableId" = s."id" AND ir."companyId" = li."companyId"
LEFT JOIN (
  SELECT
    "itemId",
    "companyId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId", "companyId"
) ps ON ps."itemId" = li."id" AND ps."companyId" = li."companyId"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId"
LEFT JOIN "itemCost" ic ON ic."itemId" = li.id;
