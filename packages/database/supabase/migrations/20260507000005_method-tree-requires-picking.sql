-- ============================================================
-- get_method_tree: include methodMaterial.requiresPicking so the
-- BoM-explosion path in get-method/index.ts can propagate the flag
-- into jobMaterial.requiresPicking. Without this, line-side BoM
-- choices never reach the job and every material defaults to
-- requiresPicking = true.
--
-- Mechanically identical to 20260408000000_method-tree-replenishment
-- with one new column at the end of the return TABLE + recursive CTE
-- + final SELECT (false fallback on the root row since a root
-- "Make to Order" item has no methodMaterial.requiresPicking column).
-- ============================================================

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
    "externalId" JSONB,
    "version" NUMERIC(10,2),
    "shelfIds" JSONB,
    "isPickDescendant" BOOLEAN,
    "replenishmentSystem" "itemReplenishmentSystem",
    "requiresPicking" BOOLEAN
) AS $$
WITH RECURSIVE material AS (
    SELECT
        "id",
        "makeMethodId",
        "methodType",
        COALESCE(
            "materialMakeMethodId",
            CASE WHEN "methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = "methodMaterial"."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        "itemId",
        "itemType",
        "quantity",
        "makeMethodId" AS "parentMaterialId",
        NULL AS "operationId",
        COALESCE("order", 1) AS "order",
        "kit",
        "shelfIds",
        false AS "isPickDescendant",
        COALESCE("requiresPicking", true) AS "requiresPicking"
    FROM
        "methodMaterial"
    WHERE
        "makeMethodId" = uid
    UNION
    SELECT
        child."id",
        child."makeMethodId",
        child."methodType",
        COALESCE(
            child."materialMakeMethodId",
            CASE WHEN child."methodType" = 'Pull from Inventory' THEN (
                SELECT amm.id FROM "activeMakeMethods" amm WHERE amm."itemId" = child."itemId" LIMIT 1
            ) END
        ) AS "materialMakeMethodId",
        child."itemId",
        child."itemType",
        child."quantity",
        parent."id" AS "parentMaterialId",
        child."methodOperationId" AS "operationId",
        child."order",
        child."kit",
        child."shelfIds",
        (parent."methodType" = 'Pull from Inventory' OR parent."isPickDescendant") AS "isPickDescendant",
        COALESCE(child."requiresPicking", true) AS "requiresPicking"
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
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm2."version",
  material."shelfIds",
  material."isPickDescendant",
  item."replenishmentSystem",
  material."requiresPicking"
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
  'Make to Order' AS "methodType",
  item."itemTrackingType",
  NULL AS "parentMaterialId",
  CAST(1 AS DOUBLE PRECISION) AS "order",
  NULL AS "operationId",
  true AS "isRoot",
  false AS "kit",
  item."revision",
  (
    SELECT COALESCE(
      jsonb_object_agg(
        eim."integration",
        CASE
          WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
          ELSE to_jsonb(eim."externalId")
        END
      ) FILTER (WHERE eim."externalId" IS NOT NULL),
      '{}'::jsonb
    )
    FROM "externalIntegrationMapping" eim
    WHERE eim."entityType" = 'item' AND eim."entityId" = item.id
  ) AS "externalId",
  mm."version",
  '{}'::JSONB AS "shelfIds",
  false AS "isPickDescendant",
  item."replenishmentSystem",
  true AS "requiresPicking"
FROM "makeMethod" mm
INNER JOIN item
  ON mm."itemId" = item.id
INNER JOIN "itemCost" cost
  ON item.id = cost."itemId"
WHERE mm.id = uid
ORDER BY "order"
$$ LANGUAGE sql STABLE;
