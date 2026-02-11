CREATE MATERIALIZED VIEW "itemStockQuantities" AS
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", '') AS "locationId",
  SUM("quantity") AS "quantityOnHand"
FROM "itemLedger"
GROUP BY "itemId", "companyId", COALESCE("locationId", '');

CREATE UNIQUE INDEX "itemStockQuantities_itemId_companyId_locationId_idx"
  ON "itemStockQuantities" ("itemId", "companyId", "locationId");

CREATE INDEX "itemStockQuantities_companyId_idx"
  ON "itemStockQuantities" ("companyId");

-- Refresh every 30 minutes via pg_cron (extension already created in embeddings migration)
SELECT
  cron.schedule(
    'refresh-item-stock-quantities',
    '*/30 * * * *',
    $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY "itemStockQuantities";
    $$
  );
