-- Fix: Trigger functions were missing companyGroupId in their INSERT statements.
-- After the company-groups migration added NOT NULL companyGroupId columns to
-- posting group tables and itemUnitSalePrice, these triggers would fail.

-- 1. Fix create_item_related_records (item trigger)
CREATE OR REPLACE FUNCTION public.create_item_related_records()
RETURNS TRIGGER AS $$
DECLARE
  base_currency TEXT;
  company_group_id TEXT;
BEGIN
  SELECT "baseCurrencyCode", "companyGroupId"
  INTO base_currency, company_group_id
  FROM public."company"
  WHERE "id" = new."companyId";

  INSERT INTO public."itemCost"("itemId", "costingMethod", "createdBy", "companyId")
  VALUES (new.id, 'FIFO', new."createdBy", new."companyId");

  INSERT INTO public."itemReplenishment"("itemId", "createdBy", "companyId")
  VALUES (new.id, new."createdBy", new."companyId");

  INSERT INTO public."itemUnitSalePrice"("itemId", "currencyCode", "createdBy", "companyId", "companyGroupId")
  VALUES (new.id, COALESCE(base_currency, 'USD'), new."createdBy", new."companyId", company_group_id);

  -- Insert itemPlanning records for each location
  INSERT INTO public."itemPlanning"("itemId", "locationId", "createdBy", "companyId")
  SELECT
    new.id,
    l.id,
    new."createdBy",
    new."companyId"
  FROM public."location" l
  WHERE l."companyId" = new."companyId";

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Fix create_related_records_for_location (location trigger)
CREATE OR REPLACE FUNCTION public.create_related_records_for_location()
RETURNS TRIGGER AS $$
DECLARE
  item_posting_group RECORD;
  account_defaults RECORD;
  company_group_id TEXT;
BEGIN
  SELECT "companyGroupId" INTO company_group_id FROM "company" WHERE "id" = new."companyId";

  -- create itemPlanning records for the new location
  INSERT INTO public."itemPlanning" ("itemId", "locationId", "createdBy", "companyId", "createdAt", "updatedAt")
  SELECT
    i.id AS "itemId",
    new.id AS "locationId",
    i."createdBy",
    i."companyId",
    NOW(),
    NOW()
  FROM public."item" i
  WHERE i."companyId" = new."companyId";

  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR item_posting_group IN SELECT "id" FROM "itemPostingGroup" WHERE "companyId" = new."companyId"
  LOOP
    INSERT INTO "postingGroupInventory" (
      "itemPostingGroupId",
      "locationId",
      "costOfGoodsSoldAccount",
      "inventoryAccount",
      "inventoryInterimAccrualAccount",
      "inventoryReceivedNotInvoicedAccount",
      "inventoryInvoicedNotReceivedAccount",
      "inventoryShippedNotInvoicedAccount",
      "workInProgressAccount",
      "directCostAppliedAccount",
      "overheadCostAppliedAccount",
      "purchaseVarianceAccount",
      "inventoryAdjustmentVarianceAccount",
      "materialVarianceAccount",
      "capacityVarianceAccount",
      "overheadAccount",
      "companyId",
      "companyGroupId",
      "updatedBy"
    ) VALUES (
      item_posting_group."id",
      new."id",
      account_defaults."costOfGoodsSoldAccount",
      account_defaults."inventoryAccount",
      account_defaults."inventoryInterimAccrualAccount",
      account_defaults."inventoryReceivedNotInvoicedAccount",
      account_defaults."inventoryInvoicedNotReceivedAccount",
      account_defaults."inventoryShippedNotInvoicedAccount",
      account_defaults."workInProgressAccount",
      account_defaults."directCostAppliedAccount",
      account_defaults."overheadCostAppliedAccount",
      account_defaults."purchaseVarianceAccount",
      account_defaults."inventoryAdjustmentVarianceAccount",
      account_defaults."materialVarianceAccount",
      account_defaults."capacityVarianceAccount",
      account_defaults."overheadAccount",
      new."companyId",
      company_group_id,
      new."createdBy"
    );
  END LOOP;

  -- insert the null item group
  INSERT INTO "postingGroupInventory" (
    "itemPostingGroupId",
    "locationId",
    "costOfGoodsSoldAccount",
    "inventoryAccount",
    "inventoryInterimAccrualAccount",
    "inventoryReceivedNotInvoicedAccount",
    "inventoryInvoicedNotReceivedAccount",
    "inventoryShippedNotInvoicedAccount",
    "workInProgressAccount",
    "directCostAppliedAccount",
    "overheadCostAppliedAccount",
    "purchaseVarianceAccount",
    "inventoryAdjustmentVarianceAccount",
    "materialVarianceAccount",
    "capacityVarianceAccount",
    "overheadAccount",
    "companyId",
    "companyGroupId",
    "updatedBy"
  ) VALUES (
    NULL,
    new."id",
    account_defaults."costOfGoodsSoldAccount",
    account_defaults."inventoryAccount",
    account_defaults."inventoryInterimAccrualAccount",
    account_defaults."inventoryReceivedNotInvoicedAccount",
    account_defaults."inventoryInvoicedNotReceivedAccount",
    account_defaults."inventoryShippedNotInvoicedAccount",
    account_defaults."workInProgressAccount",
    account_defaults."directCostAppliedAccount",
    account_defaults."overheadCostAppliedAccount",
    account_defaults."purchaseVarianceAccount",
    account_defaults."inventoryAdjustmentVarianceAccount",
    account_defaults."materialVarianceAccount",
    account_defaults."capacityVarianceAccount",
    account_defaults."overheadAccount",
    new."companyId",
    company_group_id,
    new."createdBy"
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Fix create_posting_groups_for_item_posting_group (item posting group trigger)
CREATE OR REPLACE FUNCTION public.create_posting_groups_for_item_posting_group()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
  company_group_id TEXT;
BEGIN
  SELECT "companyGroupId" INTO company_group_id FROM "company" WHERE "id" = new."companyId";
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR rec IN SELECT "id" FROM "customerType" WHERE "companyId" = new."companyId"
  LOOP
    INSERT INTO "postingGroupSales" (
      "itemPostingGroupId",
      "customerTypeId",
      "receivablesAccount",
      "salesAccount",
      "salesDiscountAccount",
      "salesCreditAccount",
      "salesPrepaymentAccount",
      "salesTaxPayableAccount",
      "companyId",
      "companyGroupId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."receivablesAccount",
      account_defaults."salesAccount",
      account_defaults."salesDiscountAccount",
      account_defaults."receivablesAccount",
      account_defaults."prepaymentAccount",
      account_defaults."salesTaxPayableAccount",
      new."companyId",
      company_group_id,
      new."createdBy"
    );
  END LOOP;

  -- insert the null customer type
  INSERT INTO "postingGroupSales" (
    "itemPostingGroupId",
    "customerTypeId",
    "receivablesAccount",
    "salesAccount",
    "salesDiscountAccount",
    "salesCreditAccount",
    "salesPrepaymentAccount",
    "salesTaxPayableAccount",
    "companyId",
    "companyGroupId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."receivablesAccount",
    account_defaults."salesAccount",
    account_defaults."salesDiscountAccount",
    account_defaults."receivablesAccount",
    account_defaults."prepaymentAccount",
    account_defaults."salesTaxPayableAccount",
    new."companyId",
    company_group_id,
    new."createdBy"
  );

  FOR rec IN SELECT "id" FROM "supplierType" WHERE "companyId" = new."companyId"
  LOOP
    INSERT INTO "postingGroupPurchasing" (
      "itemPostingGroupId",
      "supplierTypeId",
      "payablesAccount",
      "purchaseAccount",
      "purchaseDiscountAccount",
      "purchaseCreditAccount",
      "purchasePrepaymentAccount",
      "purchaseTaxPayableAccount",
      "companyId",
      "companyGroupId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."payablesAccount",
      account_defaults."purchaseAccount",
      account_defaults."purchaseAccount",
      account_defaults."payablesAccount",
      account_defaults."prepaymentAccount",
      account_defaults."purchaseTaxPayableAccount",
      new."companyId",
      company_group_id,
      new."createdBy"
    );
  END LOOP;

  -- insert the null supplier type
  INSERT INTO "postingGroupPurchasing" (
    "itemPostingGroupId",
    "supplierTypeId",
    "payablesAccount",
    "purchaseAccount",
    "purchaseDiscountAccount",
    "purchaseCreditAccount",
    "purchasePrepaymentAccount",
    "purchaseTaxPayableAccount",
    "companyId",
    "companyGroupId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."payablesAccount",
    account_defaults."purchaseAccount",
    account_defaults."purchaseAccount",
    account_defaults."payablesAccount",
    account_defaults."prepaymentAccount",
    account_defaults."purchaseTaxPayableAccount",
    new."companyId",
    company_group_id,
    new."createdBy"
  );

  FOR rec IN SELECT "id" FROM "location" WHERE "companyId" = new."companyId"
  LOOP
    INSERT INTO "postingGroupInventory" (
      "itemPostingGroupId",
      "locationId",
      "costOfGoodsSoldAccount",
      "inventoryAccount",
      "inventoryInterimAccrualAccount",
      "inventoryReceivedNotInvoicedAccount",
      "inventoryInvoicedNotReceivedAccount",
      "inventoryShippedNotInvoicedAccount",
      "workInProgressAccount",
      "directCostAppliedAccount",
      "overheadCostAppliedAccount",
      "purchaseVarianceAccount",
      "inventoryAdjustmentVarianceAccount",
      "materialVarianceAccount",
      "capacityVarianceAccount",
      "overheadAccount",
      "companyId",
      "companyGroupId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."costOfGoodsSoldAccount",
      account_defaults."inventoryAccount",
      account_defaults."inventoryInterimAccrualAccount",
      account_defaults."inventoryReceivedNotInvoicedAccount",
      account_defaults."inventoryInvoicedNotReceivedAccount",
      account_defaults."inventoryShippedNotInvoicedAccount",
      account_defaults."workInProgressAccount",
      account_defaults."directCostAppliedAccount",
      account_defaults."overheadCostAppliedAccount",
      account_defaults."purchaseVarianceAccount",
      account_defaults."inventoryAdjustmentVarianceAccount",
      account_defaults."materialVarianceAccount",
      account_defaults."capacityVarianceAccount",
      account_defaults."overheadAccount",
      new."companyId",
      company_group_id,
      new."createdBy"
    );
  END LOOP;

  -- insert the null location
  INSERT INTO "postingGroupInventory" (
    "itemPostingGroupId",
    "locationId",
    "costOfGoodsSoldAccount",
    "inventoryAccount",
    "inventoryInterimAccrualAccount",
    "inventoryReceivedNotInvoicedAccount",
    "inventoryInvoicedNotReceivedAccount",
    "inventoryShippedNotInvoicedAccount",
    "workInProgressAccount",
    "directCostAppliedAccount",
    "overheadCostAppliedAccount",
    "purchaseVarianceAccount",
    "inventoryAdjustmentVarianceAccount",
    "materialVarianceAccount",
    "capacityVarianceAccount",
    "overheadAccount",
    "companyId",
    "companyGroupId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."costOfGoodsSoldAccount",
    account_defaults."inventoryAccount",
    account_defaults."inventoryInterimAccrualAccount",
    account_defaults."inventoryReceivedNotInvoicedAccount",
    account_defaults."inventoryInvoicedNotReceivedAccount",
    account_defaults."inventoryShippedNotInvoicedAccount",
    account_defaults."workInProgressAccount",
    account_defaults."directCostAppliedAccount",
    account_defaults."overheadCostAppliedAccount",
    account_defaults."purchaseVarianceAccount",
    account_defaults."inventoryAdjustmentVarianceAccount",
    account_defaults."materialVarianceAccount",
    account_defaults."capacityVarianceAccount",
    account_defaults."overheadAccount",
    new."companyId",
    company_group_id,
    new."createdBy"
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Fix create_posting_groups_for_customer_type (customer type trigger)
CREATE OR REPLACE FUNCTION public.create_posting_groups_for_customer_type()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
  company_group_id TEXT;
BEGIN
  SELECT "companyGroupId" INTO company_group_id FROM "company" WHERE "id" = new."companyId";
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR rec IN SELECT "id" FROM "itemPostingGroup" WHERE "companyId" = new."companyId"
  LOOP
    INSERT INTO "postingGroupSales" (
      "customerTypeId",
      "itemPostingGroupId",
      "receivablesAccount",
      "salesAccount",
      "salesDiscountAccount",
      "salesCreditAccount",
      "salesPrepaymentAccount",
      "salesTaxPayableAccount",
      "companyId",
      "companyGroupId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."receivablesAccount",
      account_defaults."salesAccount",
      account_defaults."salesDiscountAccount",
      account_defaults."salesAccount",
      account_defaults."prepaymentAccount",
      account_defaults."salesTaxPayableAccount",
      new."companyId",
      company_group_id,
      new."createdBy"
    );
  END LOOP;

  -- insert the null item group
  INSERT INTO "postingGroupSales" (
    "customerTypeId",
    "itemPostingGroupId",
    "receivablesAccount",
    "salesAccount",
    "salesDiscountAccount",
    "salesCreditAccount",
    "salesPrepaymentAccount",
    "salesTaxPayableAccount",
    "companyId",
    "companyGroupId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."receivablesAccount",
    account_defaults."salesAccount",
    account_defaults."salesDiscountAccount",
    account_defaults."salesAccount",
    account_defaults."prepaymentAccount",
    account_defaults."salesTaxPayableAccount",
    new."companyId",
    company_group_id,
    new."createdBy"
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. Fix create_posting_groups_for_supplier_type (supplier type trigger)
CREATE OR REPLACE FUNCTION public.create_posting_groups_for_supplier_type()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
  company_group_id TEXT;
BEGIN
  SELECT "companyGroupId" INTO company_group_id FROM "company" WHERE "id" = new."companyId";
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR rec IN SELECT "id" FROM "itemPostingGroup" WHERE "companyId" = new."companyId"
  LOOP
    INSERT INTO "postingGroupPurchasing" (
      "supplierTypeId",
      "itemPostingGroupId",
      "payablesAccount",
      "purchaseAccount",
      "purchaseDiscountAccount",
      "purchaseCreditAccount",
      "purchasePrepaymentAccount",
      "purchaseTaxPayableAccount",
      "companyId",
      "companyGroupId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."payablesAccount",
      account_defaults."purchaseAccount",
      account_defaults."purchaseAccount",
      account_defaults."purchaseAccount",
      account_defaults."prepaymentAccount",
      account_defaults."purchaseTaxPayableAccount",
      new."companyId",
      company_group_id,
      new."createdBy"
    );
  END LOOP;

  -- insert the null item group
  INSERT INTO "postingGroupPurchasing" (
    "supplierTypeId",
    "itemPostingGroupId",
    "payablesAccount",
    "purchaseAccount",
    "purchaseDiscountAccount",
    "purchaseCreditAccount",
    "purchasePrepaymentAccount",
    "purchaseTaxPayableAccount",
    "companyId",
    "companyGroupId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."payablesAccount",
    account_defaults."purchaseAccount",
    account_defaults."purchaseAccount",
    account_defaults."purchaseAccount",
    account_defaults."prepaymentAccount",
    account_defaults."purchaseTaxPayableAccount",
    new."companyId",
    company_group_id,
    new."createdBy"
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
