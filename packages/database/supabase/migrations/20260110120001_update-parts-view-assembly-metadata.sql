-- Update parts view to include assembly metadata from modelUpload

DROP VIEW IF EXISTS "parts";
CREATE OR REPLACE VIEW "parts" WITH (SECURITY_INVOKER=true) AS
WITH latest_items AS (
  SELECT DISTINCT ON (i."readableId")
    i.*,
    mu.id as "modelUploadId",
    mu."modelPath",
    mu."thumbnailPath" as "modelThumbnailPath",
    mu."name" as "modelName",
    mu."size" as "modelSize",
    mu."assemblyMetadata",
    mu."parsingStatus",
    mu."parsedAt",
    mu."parsingError"
  FROM "item" i
  LEFT JOIN "modelUpload" mu ON mu.id = i."modelUploadId"
  ORDER BY i."readableId", i."createdAt" DESC NULLS LAST
),
item_revisions AS (
  SELECT
    i."readableId",
    json_agg(
      json_build_object(
        'id', i.id,
        'revision', i."revision",
        'name', i."name",
        'description', i."description",
        'active', i."active",
        'createdAt', i."createdAt"
      ) ORDER BY i."createdAt"
    ) as "revisions"
  FROM "item" i
  GROUP BY i."readableId"
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
  li."assemblyMetadata",
  li."parsingStatus",
  li."parsedAt",
  li."parsingError",
  ps."supplierIds",
  uom.name as "unitOfMeasure",
  ir."revisions",
  p."customFields",
  p."tags",
  li."createdBy",
  li."createdAt",
  li."updatedBy",
  li."updatedAt"
FROM "part" p
INNER JOIN latest_items li ON li."readableId" = p."id"
LEFT JOIN item_revisions ir ON ir."readableId" = p."id"
LEFT JOIN (
  SELECT
    "itemId",
    string_agg(ps."supplierPartId", ',') AS "supplierIds"
  FROM "supplierPart" ps
  GROUP BY "itemId"
) ps ON ps."itemId" = li."id"
LEFT JOIN "unitOfMeasure" uom ON uom.code = li."unitOfMeasureCode" AND uom."companyId" = li."companyId";
