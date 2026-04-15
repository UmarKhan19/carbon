import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { pricingRuleValidator } from "./pricing.models";

export async function getPricingRules(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search?: string }
) {
  let query = client
    .from("pricingRule")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args);
  }

  return query;
}

export async function getPricingRule(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("pricingRule").select("*").eq("id", id).single();
}

export async function createPricingRule(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  data: z.infer<typeof pricingRuleValidator>
) {
  return client
    .from("pricingRule")
    .insert([
      {
        name: data.name,
        ruleType: data.ruleType,
        amountType: data.amountType,
        amount: data.amount,
        minQuantity: data.minQuantity ?? null,
        maxQuantity: data.maxQuantity ?? null,
        customerIds: data.customerIds ?? [],
        customerTypeIds: data.customerTypeIds ?? [],
        itemIds: data.itemIds ?? [],
        itemPostingGroupId: data.itemPostingGroupId ?? null,
        validFrom: data.validFrom || null,
        validTo: data.validTo || null,
        formulaBase: data.formulaBase ?? null,
        minMarginPercent: data.minMarginPercent ?? null,
        active: data.active ?? true,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();
}

export async function updatePricingRule(
  client: SupabaseClient<Database>,
  id: string,
  userId: string,
  data: Partial<z.infer<typeof pricingRuleValidator>>
) {
  return client
    .from("pricingRule")
    .update(
      sanitize({
        ...data,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", id)
    .select("id")
    .single();
}

export async function deletePricingRule(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("pricingRule").delete().eq("id", id);
}

export async function duplicatePricingRule(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string,
  userId: string
) {
  const { data: original, error: fetchError } = await getPricingRule(
    client,
    id
  );
  if (fetchError || !original) return { data: null, error: fetchError };

  return client
    .from("pricingRule")
    .insert([
      {
        name: `Copy of ${original.name}`,
        ruleType: original.ruleType,
        amountType: original.amountType,
        amount: original.amount,
        minQuantity: original.minQuantity,
        maxQuantity: original.maxQuantity,
        customerIds: original.customerIds,
        customerTypeIds: original.customerTypeIds,
        itemIds: original.itemIds,
        itemPostingGroupId: original.itemPostingGroupId,
        validFrom: original.validFrom,
        validTo: original.validTo,
        formulaBase: original.formulaBase,
        minMarginPercent: original.minMarginPercent,
        active: false,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();
}

export async function getItemSalePriceBreaks(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemSalePriceBreak")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("minQuantity", { ascending: true });
}

export async function getItemSalePriceBreakSummary(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("itemSalePriceBreak")
    .select("customerTypeId, customerType(name)")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .not("customerTypeId", "is", null);
}

export async function getItemSalePriceBreaksForCustomerType(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  customerTypeId: string
) {
  return client
    .from("itemSalePriceBreak")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("customerTypeId", customerTypeId)
    .order("minQuantity", { ascending: true });
}

// -- Customer Item Price Overrides --

export async function getCustomerItemPriceOverride(
  client: SupabaseClient<Database>,
  customerId: string,
  itemId: string,
  companyId: string
) {
  return client
    .from("customerItemPriceOverride")
    .select("*")
    .eq("customerId", customerId)
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();
}

export async function getCustomerTypeItemPriceOverride(
  client: SupabaseClient<Database>,
  customerTypeId: string,
  itemId: string,
  companyId: string
) {
  return client
    .from("customerItemPriceOverride")
    .select("*")
    .eq("customerTypeId", customerTypeId)
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();
}

export async function getCustomerItemPriceOverrides(
  client: SupabaseClient<Database>,
  companyId: string,
  opts: { customerId?: string; customerTypeId?: string }
) {
  let query = client
    .from("customerItemPriceOverride")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true);

  if (opts.customerId) {
    query = query.eq("customerId", opts.customerId);
  } else if (opts.customerTypeId) {
    query = query.eq("customerTypeId", opts.customerTypeId);
  }

  return query;
}

export async function upsertCustomerItemPriceOverride(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  data: {
    customerId?: string;
    customerTypeId?: string;
    itemId: string;
    overridePrice: number;
    notes?: string;
  }
) {
  // Determine scope: customer-specific or customer-type
  if (data.customerId) {
    // First check if a matching row exists (partial unique index, can't use onConflict directly)
    const { data: existing } = await client
      .from("customerItemPriceOverride")
      .select("id")
      .eq("customerId", data.customerId)
      .eq("itemId", data.itemId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (existing) {
      return client
        .from("customerItemPriceOverride")
        .update({
          overridePrice: data.overridePrice,
          notes: data.notes ?? null,
          active: true,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("id")
        .single();
    }

    return client
      .from("customerItemPriceOverride")
      .insert({
        customerId: data.customerId,
        itemId: data.itemId,
        overridePrice: data.overridePrice,
        notes: data.notes ?? null,
        active: true,
        companyId,
        createdBy: userId,
      })
      .select("id")
      .single();
  }

  if (data.customerTypeId) {
    const { data: existing } = await client
      .from("customerItemPriceOverride")
      .select("id")
      .eq("customerTypeId", data.customerTypeId)
      .eq("itemId", data.itemId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (existing) {
      return client
        .from("customerItemPriceOverride")
        .update({
          overridePrice: data.overridePrice,
          notes: data.notes ?? null,
          active: true,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("id")
        .single();
    }

    return client
      .from("customerItemPriceOverride")
      .insert({
        customerTypeId: data.customerTypeId,
        itemId: data.itemId,
        overridePrice: data.overridePrice,
        notes: data.notes ?? null,
        active: true,
        companyId,
        createdBy: userId,
      })
      .select("id")
      .single();
  }

  return { data: null, error: { message: "Either customerId or customerTypeId is required" } };
}

export async function deleteCustomerItemPriceOverride(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("customerItemPriceOverride").delete().eq("id", id);
}

// -- Price List (batch resolution) --

export type PriceListRow = {
  itemId: string;
  partId: string;
  itemName: string;
  basePrice: number;
  resolvedPrice: number;
  isOverridden: boolean;
  trace: PriceTraceStep[];
};

export type PriceListResult = {
  data: PriceListRow[];
  count: number;
};

export async function resolvePriceList(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    customerId?: string;
    customerTypeId?: string;
    search?: string;
  }
): Promise<PriceListResult> {
  const date = new Date().toISOString().split("T")[0]!;

  // 1. Fetch paginated items with base prices
  let itemQuery = client
    .from("item")
    .select(
      "id, readableId, name, itemUnitSalePrice(unitSalePrice)",
      { count: "exact" }
    )
    .eq("active", true);

  if (args.search) {
    itemQuery = itemQuery.or(
      `name.ilike.%${args.search}%,readableId.ilike.%${args.search}%`
    );
  }

  itemQuery = setGenericQueryFilters(itemQuery, args);

  const { data: items, count } = await itemQuery;
  if (!items || items.length === 0) {
    return { data: [], count: count ?? 0 };
  }

  const itemIds = items.map((i) => i.id);

  // 2. Resolve customer type if needed
  let resolvedCustomerTypeId = args.customerTypeId ?? null;
  if (args.customerId && !resolvedCustomerTypeId) {
    const { data: cust } = await client
      .from("customer")
      .select("customerTypeId")
      .eq("id", args.customerId)
      .maybeSingle();
    resolvedCustomerTypeId = cust?.customerTypeId ?? null;
  }

  // 3. Batch-fetch overrides for this customer
  const overrideMap = new Map<
    string,
    { overridePrice: number; notes: string | null }
  >();
  if (args.customerId) {
    const { data: overrides } = await client
      .from("customerItemPriceOverride")
      .select("itemId, overridePrice, notes, validFrom, validTo")
      .eq("companyId", companyId)
      .eq("customerId", args.customerId)
      .eq("active", true)
      .in("itemId", itemIds);

    for (const ov of overrides ?? []) {
      const withinRange =
        (!ov.validFrom || ov.validFrom <= date) &&
        (!ov.validTo || ov.validTo >= date);
      if (withinRange) {
        overrideMap.set(ov.itemId, {
          overridePrice: ov.overridePrice,
          notes: ov.notes,
        });
      }
    }
  }

  // 3b. Batch-fetch customer-type overrides
  const typeOverrideMap = new Map<
    string,
    { overridePrice: number; notes: string | null }
  >();
  if (resolvedCustomerTypeId) {
    const { data: typeOverrides } = await client
      .from("customerItemPriceOverride")
      .select("itemId, overridePrice, notes, validFrom, validTo")
      .eq("companyId", companyId)
      .eq("customerTypeId", resolvedCustomerTypeId)
      .eq("active", true)
      .in("itemId", itemIds);

    for (const ov of typeOverrides ?? []) {
      const withinRange =
        (!ov.validFrom || ov.validFrom <= date) &&
        (!ov.validTo || ov.validTo >= date);
      if (withinRange) {
        typeOverrideMap.set(ov.itemId, {
          overridePrice: ov.overridePrice,
          notes: ov.notes,
        });
      }
    }
  }

  // 4. Fetch all active pricing rules once
  let rulesQuery = client
    .from("pricingRule")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true);

  rulesQuery = rulesQuery.or(`validFrom.is.null,validFrom.lte.${date}`);
  rulesQuery = rulesQuery.or(`validTo.is.null,validTo.gte.${date}`);

  const { data: allRules } = await rulesQuery;

  // 5. Batch-fetch price breaks for these items
  const { data: allBreaks } = await client
    .from("itemSalePriceBreak")
    .select("*")
    .eq("companyId", companyId)
    .in("itemId", itemIds)
    .order("minQuantity", { ascending: false });

  // 6. Resolve each item
  const rows: PriceListRow[] = items.map((item) => {
    const salePriceRow = Array.isArray(item.itemUnitSalePrice)
      ? item.itemUnitSalePrice[0]
      : item.itemUnitSalePrice;
    const basePrice = salePriceRow?.unitSalePrice ?? 0;
    const trace: PriceTraceStep[] = [];

    // Check customer-specific override first (highest priority)
    const override = overrideMap.get(item.id);
    if (override) {
      trace.push({
        step: "Base Price",
        source: "Item Unit Sale Price",
        amount: basePrice,
      });
      trace.push({
        step: "Override",
        source: override.notes
          ? `Customer Price Override: ${override.notes}`
          : "Customer Price Override",
        amount: override.overridePrice,
        adjustment: override.overridePrice - basePrice,
      });
      trace.push({
        step: "Final Price",
        source: "Resolved",
        amount: override.overridePrice,
      });
      return {
        itemId: item.id,
        partId: item.readableId,
        itemName: item.name,
        basePrice,
        resolvedPrice: override.overridePrice,
        isOverridden: true,
        trace,
      };
    }

    // Check customer-type override (second priority)
    const typeOverride = typeOverrideMap.get(item.id);
    if (typeOverride) {
      trace.push({
        step: "Base Price",
        source: "Item Unit Sale Price",
        amount: basePrice,
      });
      trace.push({
        step: "Type Override",
        source: typeOverride.notes
          ? `Customer Type Override: ${typeOverride.notes}`
          : "Customer Type Override",
        amount: typeOverride.overridePrice,
        adjustment: typeOverride.overridePrice - basePrice,
      });
      trace.push({
        step: "Final Price",
        source: "Resolved",
        amount: typeOverride.overridePrice,
      });
      return {
        itemId: item.id,
        partId: item.readableId,
        itemName: item.name,
        basePrice,
        resolvedPrice: typeOverride.overridePrice,
        isOverridden: true,
        trace,
      };
    }

    // No override — apply rules
    trace.push({
      step: "Base Price",
      source: "Item Unit Sale Price",
      amount: basePrice,
    });

    // Match rules for this item
    const matchedRules: MatchedRule[] = (allRules ?? []).filter((rule) => {
      // Quantity scope: price list uses qty=1 as default
      if (rule.minQuantity !== null && 1 < rule.minQuantity) return false;
      if (rule.maxQuantity !== null && 1 > rule.maxQuantity) return false;

      const ruleItemIds = rule.itemIds as string[] | null;
      if (ruleItemIds && ruleItemIds.length > 0 && !ruleItemIds.includes(item.id)) return false;
      if (rule.itemPostingGroupId !== null) return false; // can't match without item's group

      const ruleCustomerIds = rule.customerIds as string[] | null;
      const ruleCustomerTypeIds = rule.customerTypeIds as string[] | null;

      if (ruleCustomerIds && ruleCustomerIds.length > 0) {
        if (!args.customerId || !ruleCustomerIds.includes(args.customerId))
          return false;
      }
      if (ruleCustomerTypeIds && ruleCustomerTypeIds.length > 0) {
        if (
          !resolvedCustomerTypeId ||
          !ruleCustomerTypeIds.includes(resolvedCustomerTypeId)
        )
          return false;
      }

      return true;
    });

    const { finalPrice, appendedTrace } = applyPriceRules(
      basePrice,
      matchedRules
    );
    trace.push(...appendedTrace);
    trace.push({
      step: "Final Price",
      source: "Resolved",
      amount: finalPrice,
    });

    return {
      itemId: item.id,
      partId: item.readableId,
      itemName: item.name,
      basePrice,
      resolvedPrice: finalPrice,
      isOverridden: false,
      trace,
    };
  });

  return { data: rows, count: count ?? 0 };
}

// -- Types --

export type PriceTraceStep = {
  step: string;
  source: string;
  amount: number;
  adjustment?: number;
  ruleId?: string;
};

export type MatchedRule = {
  id: string;
  name: string;
  ruleType: string;
  amountType: string;
  amount: number;
};

export type PriceResolutionInput = {
  customerId?: string;
  customerTypeId?: string;
  itemId: string;
  itemPostingGroupId?: string;
  quantity: number;
  date?: string;
  existingBasePrice?: number;
};

export type PriceResolutionResult = {
  finalPrice: number;
  basePrice: number;
  trace: PriceTraceStep[];
};

export function applyPriceRules(
  basePrice: number,
  matchedRules: MatchedRule[]
): { finalPrice: number; appendedTrace: PriceTraceStep[] } {
  const appendedTrace: PriceTraceStep[] = [];
  let finalPrice = basePrice;

  const markupRules = matchedRules.filter((r) => r.ruleType === "Markup");
  const discountRules = matchedRules.filter((r) => r.ruleType === "Discount");

  // Discounts: best rate wins (non-stacking)
  if (discountRules.length > 0) {
    let bestDiscount = 0;
    let bestRule: MatchedRule | null = null;

    for (const rule of discountRules) {
      const effective =
        rule.amountType === "Percentage"
          ? basePrice * rule.amount
          : rule.amount;

      if (effective > bestDiscount) {
        bestDiscount = effective;
        bestRule = rule;
      }
    }

    if (bestRule) {
      finalPrice -= bestDiscount;
      appendedTrace.push({
        step: "Discount",
        source: `Rule: ${bestRule.name}`,
        amount: finalPrice,
        adjustment: -bestDiscount,
        ruleId: bestRule.id
      });
    }
  }

  // Markups: all stack additively
  for (const rule of markupRules) {
    const adjustment =
      rule.amountType === "Percentage" ? basePrice * rule.amount : rule.amount;

    finalPrice += adjustment;
    appendedTrace.push({
      step: "Markup",
      source: `Rule: ${rule.name}`,
      amount: finalPrice,
      adjustment,
      ruleId: rule.id
    });
  }

  finalPrice = Math.max(0, finalPrice);
  return { finalPrice, appendedTrace };
}

export async function resolvePrice(
  client: SupabaseClient<Database>,
  companyId: string,
  input: PriceResolutionInput
): Promise<PriceResolutionResult> {
  const date = input.date ?? new Date().toISOString().split("T")[0]!;
  const trace: PriceTraceStep[] = [];

  let resolvedCustomerTypeId = input.customerTypeId ?? null;

  if (input.customerId && !resolvedCustomerTypeId) {
    const { data: cust } = await client
      .from("customer")
      .select("customerTypeId")
      .eq("id", input.customerId)
      .maybeSingle();
    resolvedCustomerTypeId = cust?.customerTypeId ?? null;
  }

  // Step 1: Base price from item unit sale price
  let basePrice: number;
  if (input.existingBasePrice !== undefined) {
    basePrice = input.existingBasePrice;
  } else {
    const { data: salePrice } = await client
      .from("itemUnitSalePrice")
      .select("unitSalePrice")
      .eq("itemId", input.itemId)
      .maybeSingle();
    basePrice = salePrice?.unitSalePrice ?? 0;
  }

  // Step 1.5: Check for customer-specific price override (highest priority)
  if (input.customerId) {
    const { data: override } = await getCustomerItemPriceOverride(
      client,
      input.customerId,
      input.itemId,
      companyId
    );

    if (override) {
      const withinRange =
        (!override.validFrom || override.validFrom <= date) &&
        (!override.validTo || override.validTo >= date);

      if (withinRange) {
        trace.push({
          step: "Base Price",
          source: "Item Unit Sale Price",
          amount: basePrice,
        });
        trace.push({
          step: "Override",
          source: override.notes
            ? `Customer Price Override: ${override.notes}`
            : "Customer Price Override",
          amount: override.overridePrice,
          adjustment: override.overridePrice - basePrice,
        });
        trace.push({
          step: "Final Price",
          source: "Resolved",
          amount: override.overridePrice,
        });
        return { finalPrice: override.overridePrice, basePrice, trace };
      }
    }
  }

  // Step 1.6: Check for customer-type price override (second priority)
  if (resolvedCustomerTypeId) {
    const { data: typeOverride } = await getCustomerTypeItemPriceOverride(
      client,
      resolvedCustomerTypeId,
      input.itemId,
      companyId
    );

    if (typeOverride) {
      const withinRange =
        (!typeOverride.validFrom || typeOverride.validFrom <= date) &&
        (!typeOverride.validTo || typeOverride.validTo >= date);

      if (withinRange) {
        trace.push({
          step: "Base Price",
          source: "Item Unit Sale Price",
          amount: basePrice,
        });
        trace.push({
          step: "Type Override",
          source: typeOverride.notes
            ? `Customer Type Override: ${typeOverride.notes}`
            : "Customer Type Override",
          amount: typeOverride.overridePrice,
          adjustment: typeOverride.overridePrice - basePrice,
        });
        trace.push({
          step: "Final Price",
          source: "Resolved",
          amount: typeOverride.overridePrice,
        });
        return { finalPrice: typeOverride.overridePrice, basePrice, trace };
      }
    }
  }

  // Step 2: Check item price breaks
  if (input.quantity > 0) {
    let breakQuery = client
      .from("itemSalePriceBreak")
      .select("*")
      .eq("itemId", input.itemId)
      .eq("companyId", companyId)
      .lte("minQuantity", input.quantity)
      .order("minQuantity", { ascending: false })
      .limit(1);

    if (resolvedCustomerTypeId) {
      breakQuery = breakQuery.or(
        `customerTypeId.is.null,customerTypeId.eq.${resolvedCustomerTypeId}`
      );
    } else {
      breakQuery = breakQuery.is("customerTypeId", null);
    }

    const { data: breaks } = await breakQuery;
    if (breaks && breaks.length > 0) {
      const brk = breaks[0];
      if (brk.unitPrice !== null) {
        basePrice = brk.unitPrice;
        trace.push({
          step: "Price Break",
          source: `Qty >= ${brk.minQuantity} (fixed price)`,
          amount: basePrice
        });
      } else if (brk.discountPercent !== null) {
        const discount = basePrice * brk.discountPercent;
        basePrice = basePrice - discount;
        trace.push({
          step: "Price Break",
          source: `Qty >= ${brk.minQuantity} (${(brk.discountPercent * 100).toFixed(1)}% off)`,
          amount: basePrice,
          adjustment: -discount
        });
      }
    }
  }

  if (trace.length === 0) {
    trace.push({
      step: "Base Price",
      source: "Item Unit Sale Price",
      amount: basePrice
    });
  }

  // Step 3: Find applicable pricing rules
  let rulesQuery = client
    .from("pricingRule")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true);

  rulesQuery = rulesQuery.or(`validFrom.is.null,validFrom.lte.${date}`);
  rulesQuery = rulesQuery.or(`validTo.is.null,validTo.gte.${date}`);

  const { data: allRules } = await rulesQuery;

  const matchedRules: MatchedRule[] = (allRules ?? []).filter((rule) => {
    if (rule.minQuantity !== null && input.quantity < rule.minQuantity)
      return false;
    if (rule.maxQuantity !== null && input.quantity > rule.maxQuantity)
      return false;

    // Item scope: rule must match item directly, via group, or be unscoped
    const ruleItemIds = rule.itemIds as string[] | null;
    if (ruleItemIds && ruleItemIds.length > 0 && !ruleItemIds.includes(input.itemId)) return false;
    if (
      rule.itemPostingGroupId !== null &&
      rule.itemPostingGroupId !== (input.itemPostingGroupId ?? null)
    )
      return false;

    // Customer scope: empty arrays mean "all"
    const ruleCustomerIds = (rule as any).customerIds as string[] | null;
    const ruleCustomerTypeIds = (rule as any).customerTypeIds as
      | string[]
      | null;

    if (ruleCustomerIds && ruleCustomerIds.length > 0) {
      if (!input.customerId || !ruleCustomerIds.includes(input.customerId))
        return false;
    }
    if (ruleCustomerTypeIds && ruleCustomerTypeIds.length > 0) {
      if (
        !resolvedCustomerTypeId ||
        !ruleCustomerTypeIds.includes(resolvedCustomerTypeId)
      )
        return false;
    }

    return true;
  });

  // Step 4: Apply rules
  const { finalPrice, appendedTrace } = applyPriceRules(
    basePrice,
    matchedRules
  );
  trace.push(...appendedTrace);

  trace.push({
    step: "Final Price",
    source: "Resolved",
    amount: finalPrice
  });

  return { finalPrice, basePrice, trace };
}
