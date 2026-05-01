-- Fix item insert interceptor to include companyGroupId on itemUnitSalePrice.
-- The original item interceptor migration exists on main, so redefine the
-- function in a new migration rather than editing historical migration SQL.

CREATE OR REPLACE FUNCTION sync_create_item_related_records(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_currency TEXT;
  company_group_id TEXT;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  SELECT "baseCurrencyCode", "companyGroupId"
  INTO base_currency, company_group_id
  FROM "company"
  WHERE "id" = p_new->>'companyId';

  INSERT INTO "itemCost"("itemId", "costingMethod", "createdBy", "companyId")
  VALUES (p_new->>'id', 'FIFO', p_new->>'createdBy', p_new->>'companyId');

  INSERT INTO "itemReplenishment"("itemId", "createdBy", "companyId")
  VALUES (p_new->>'id', p_new->>'createdBy', p_new->>'companyId');

  INSERT INTO "itemUnitSalePrice"("itemId", "currencyCode", "createdBy", "companyId", "companyGroupId")
  VALUES (p_new->>'id', COALESCE(base_currency, 'USD'), p_new->>'createdBy', p_new->>'companyId', company_group_id);

  -- Insert itemPlanning records for each location in the company
  INSERT INTO "itemPlanning"("itemId", "locationId", "createdBy", "companyId")
  SELECT
    p_new->>'id',
    l.id,
    p_new->>'createdBy',
    p_new->>'companyId'
  FROM "location" l
  WHERE l."companyId" = p_new->>'companyId';
END;
$$;
