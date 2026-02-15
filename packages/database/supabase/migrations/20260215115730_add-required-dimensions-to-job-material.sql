-- Add required dimension fields to jobMaterial table
ALTER TABLE "jobMaterial"
ADD COLUMN IF NOT EXISTS "requiredLength" NUMERIC,
ADD COLUMN IF NOT EXISTS "requiredWidth" NUMERIC,
ADD COLUMN IF NOT EXISTS "requiredHeight" NUMERIC;

-- Add comments for the new columns
COMMENT ON COLUMN "jobMaterial"."requiredLength" IS 'Required length dimension for materials that require dimension tracking (copied from methodMaterial)';
COMMENT ON COLUMN "jobMaterial"."requiredWidth" IS 'Required width dimension for materials that require dimension tracking (copied from methodMaterial)';
COMMENT ON COLUMN "jobMaterial"."requiredHeight" IS 'Required height dimension for materials that require dimension tracking (copied from methodMaterial)';

-- Update the jobMaterialWithMakeMethodId view to include the new fields
DROP VIEW IF EXISTS "jobMaterialWithMakeMethodId";
CREATE OR REPLACE VIEW "jobMaterialWithMakeMethodId" WITH(SECURITY_INVOKER=true) AS
  SELECT
    jm.*,
    s."name" AS "shelfName",
    jmm."id" AS "jobMaterialMakeMethodId",
    jmm.version AS "version",
    i."readableIdWithRevision" as "itemReadableId",
    i."readableId" as "itemReadableIdWithoutRevision",
    i."requiresDimensionTracking"
  FROM "jobMaterial" jm
  LEFT JOIN "jobMakeMethod" jmm
    ON jmm."parentMaterialId" = jm."id"
  LEFT JOIN "shelf" s ON s.id = jm."shelfId"
  INNER JOIN "item" i ON i.id = jm."itemId";

-- Update get_method_tree function to include required dimensions
DROP FUNCTION IF EXISTS get_method_tree;
CREATE OR REPLACE FUNCTION get_method_tree(uid TEXT)
RETURNS TABLE (
    "methodMaterialId" TEXT,
    "makeMethodId" TEXT,
    "materialMakeMethodId" TEXT,  
    "itemId" TEXT,
    "itemReadableId" TEXT,
    "itemType" TEXT,
    "description" TEXT,
    "unitOfMeasureCode" TEXT,
    "unitCost" NUMERIC,
    "quantity" NUMERIC,
    "methodType" "methodType",
    "itemTrackingType" TEXT,
    "parentMaterialId" TEXT,
    "order" DOUBLE PRECISION,
    "operationId" TEXT,
    "isRoot" BOOLEAN,
    "kit" BOOLEAN,
    "revision" TEXT,
    "version" NUMERIC(10,2),
    "shelfIds" JSONB,
    "requiredLength" NUMERIC,
    "requiredWidth" NUMERIC,
    "requiredHeight" NUMERIC
) AS $$
WITH RECURSIVE material AS (
    SELECT 
        "id", 
        "makeMethodId",
        "methodType",
        "materialMakeMethodId",
        "itemId", 
        "itemType",
        "quantity",
        "makeMethodId" AS "parentMaterialId",
        NULL AS "operationId",
        COALESCE("order", 1) AS "order",
        "kit",
        "shelfIds",
        "requiredLength",
        "requiredWidth",
        "requiredHeight"
    FROM 
        "methodMaterial" 
    WHERE 
        "makeMethodId" = uid
    UNION 
    SELECT 
        child."id", 
        child."makeMethodId",
        child."methodType",
        child."materialMakeMethodId",
        child."itemId", 
        child."itemType",
        child."quantity",
        parent."id" AS "parentMaterialId",
        child."methodOperationId" AS "operationId",
        child."order",
        child."kit",
        child."shelfIds",
        child."requiredLength",
        child."requiredWidth",
        child."requiredHeight"
    FROM 
        "methodMaterial" child 
        INNER JOIN material parent ON parent."materialMakeMethodId" = child."makeMethodId"
) 
SELECT 
  material.id as "methodMaterialId", 
  material."makeMethodId",
  material."materialMakeMethodId",
  material."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  material."itemType",
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  material."quantity",
  material."methodType",
  item."itemTrackingType",
  material."parentMaterialId",
  material."order",
  material."operationId",
  false AS "isRoot",
  material."kit",
  item."revision",
  mm2."version",
  material."shelfIds",
  material."requiredLength",
  material."requiredWidth",
  material."requiredHeight"
FROM material 
INNER JOIN item 
  ON material."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
INNER JOIN "makeMethod" mm 
  ON material."makeMethodId" = mm.id
LEFT JOIN "makeMethod" mm2 
  ON material."materialMakeMethodId" = mm2.id
UNION
SELECT
  mm."id" AS "methodMaterialId",
  NULL AS "makeMethodId",
  mm.id AS "materialMakeMethodId",
  mm."itemId",
  item."readableIdWithRevision" AS "itemReadableId",
  item."type"::text,
  item."name" AS "description",
  item."unitOfMeasureCode",
  cost."unitCost",
  1 AS "quantity",
  item."defaultMethodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  0 AS "order",
  NULL AS "operationId",
  true AS "isRoot",
  false AS "kit",
  item."revision",
  mm."version",
  NULL AS "shelfIds",
  NULL AS "requiredLength",
  NULL AS "requiredWidth",
  NULL AS "requiredHeight"
FROM "makeMethod" mm
INNER JOIN item 
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm."id" = uid;
$$ LANGUAGE SQL STABLE;
