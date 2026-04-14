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
        itemId: data.itemId ?? null,
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
        itemId: original.itemId,
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
    if (rule.itemId !== null && rule.itemId !== input.itemId) return false;
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
