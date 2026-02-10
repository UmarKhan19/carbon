CREATE MATERIALIZED VIEW "itemStockQuantities" AS
SELECT
  "itemId",
  "companyId",
  SUM("quantity") AS "quantityOnHand"
FROM "itemLedger"
GROUP BY "itemId", "companyId";

CREATE UNIQUE INDEX "itemStockQuantities_itemId_companyId_idx"
  ON "itemStockQuantities" ("itemId", "companyId");

CREATE INDEX "itemStockQuantities_companyId_idx"
  ON "itemStockQuantities" ("companyId");

-- RPC function for Trigger.dev to call (REFRESH is DDL, can't go through PostgREST)
CREATE OR REPLACE FUNCTION refresh_item_stock_quantities()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY "itemStockQuantities";
END;
$$;
