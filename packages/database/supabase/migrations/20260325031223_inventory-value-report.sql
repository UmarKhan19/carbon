DROP FUNCTION IF EXISTS get_inventory_value_by_location;
CREATE OR REPLACE FUNCTION get_inventory_value_by_location(company_id TEXT)
RETURNS TABLE (
  "locationName" TEXT,
  "itemReadableId" TEXT,
  "itemName" TEXT,
  "replenishmentSystem" "itemReplenishmentSystem",
  "unitOfMeasureCode" TEXT,
  "quantityOnHand" NUMERIC,
  "unitCost" NUMERIC,
  "totalValue" NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH item_ledgers AS (
    SELECT
      il."itemId",
      il."locationId",
      SUM(il."quantity") AS "quantityOnHand"
    FROM "itemLedger" il
    WHERE il."companyId" = company_id
    GROUP BY il."itemId", il."locationId"
    HAVING SUM(il."quantity") <> 0
  )
  SELECT
    l."name" AS "locationName",
    i."readableIdWithRevision" AS "itemReadableId",
    i."name" AS "itemName",
    i."replenishmentSystem",
    i."unitOfMeasureCode",
    il."quantityOnHand",
    COALESCE(ic."unitCost", 0) AS "unitCost",
    il."quantityOnHand" * COALESCE(ic."unitCost", 0) AS "totalValue"
  FROM item_ledgers il
  INNER JOIN "item" i ON il."itemId" = i."id"
  INNER JOIN "location" l ON il."locationId" = l."id"
  LEFT JOIN "itemCost" ic ON i."id" = ic."itemId"
  WHERE i."companyId" = company_id
  ORDER BY l."name", i."readableId";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
