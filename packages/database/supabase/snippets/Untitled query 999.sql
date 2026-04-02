-- Fix sales orders without opportunities for company -- Fix sales orders without opportunities for company 8nxbDBswHsfvXg2o4itgMH
-- Creates an opportunity for each sales order missing one, then links them

WITH new_opportunities AS (
  INSERT INTO "opportunity" ("companyId", "customerId")
  SELECT so."companyId", so."customerId"
  FROM "salesOrder" so
  WHERE so."companyId" = '8nxbDBswHsfvXg2o4itgMH'
    AND so."opportunityId" IS NULL
  RETURNING id, "customerId"
),
sales_orders_to_update AS (
  SELECT
    so.id AS sales_order_id,
    no.id AS opportunity_id,
    ROW_NUMBER() OVER (PARTITION BY so."customerId" ORDER BY so.id) AS rn_so,
    ROW_NUMBER() OVER (PARTITION BY no."customerId" ORDER BY no.id) AS rn_opp
  FROM "salesOrder" so
  JOIN new_opportunities no ON no."customerId" = so."customerId"
  WHERE so."companyId" = '8nxbDBswHsfvXg2o4itgMH'
    AND so."opportunityId" IS NULL
)
UPDATE "salesOrder"
SET "opportunityId" = sou.opportunity_id
FROM (
  SELECT sales_order_id, opportunity_id
  FROM sales_orders_to_update
  WHERE rn_so = rn_opp
) sou
WHERE "salesOrder".id = sou.sales_order_id;
