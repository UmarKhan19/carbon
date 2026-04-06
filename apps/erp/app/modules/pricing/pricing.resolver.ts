import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupPriceFromBreaks } from "~/modules/shared";
import {
  getActivePriceListsForCustomer,
  getActivePriceListsForSupplier,
  getApplicableRules,
  getPriceListItemsForResolution
} from "./pricing.service";

// ============================================================
// Types
// ============================================================

export type PriceResolutionInput = {
  customerId?: string;
  customerTypeId?: string;
  supplierId?: string;
  supplierTypeId?: string;
  supplierPartId?: string;
  itemId: string;
  itemPostingGroupId?: string;
  quantity: number;
  date?: string;
  currencyCode?: string;
  exchangeRate?: number;
  listType: "Sales" | "Purchase";
  existingBasePrice?: number;
};

export type PriceTraceStep = {
  step: string;
  source: string;
  amount: number;
  adjustment?: number;
};

export type PriceResolutionResult = {
  finalPrice: number;
  basePrice: number;
  priceListId: string | null;
  priceListName: string | null;
  priceType: "Gross" | "Net" | "Discounted";
  trace: PriceTraceStep[];
};

// ============================================================
// Formula Pricing
// ============================================================

async function computeFormulaPrice(
  client: SupabaseClient<Database>,
  itemId: string,
  formulaBase: string,
  markupPercent: number,
  minMarginPercent: number | null
): Promise<number> {
  let base = 0;
  let cost = 0;

  if (formulaBase === "salePrice") {
    const { data } = await client
      .from("itemUnitSalePrice")
      .select("unitSalePrice")
      .eq("itemId", itemId)
      .maybeSingle();
    base = data?.unitSalePrice ?? 0;
  }

  const { data: costData } = await client
    .from("itemCost")
    .select("unitCost")
    .eq("itemId", itemId)
    .maybeSingle();
  cost = costData?.unitCost ?? 0;

  if (formulaBase === "cost") {
    base = cost;
  }

  let price = base * (1 + markupPercent);

  if (minMarginPercent && minMarginPercent > 0 && cost > 0) {
    const minPrice = cost / (1 - minMarginPercent);
    price = Math.max(price, minPrice);
  }

  return Math.max(0, price);
}

// ============================================================
// Specificity Scoring
// ============================================================

type AssignmentType = "direct" | "type" | "global";

function getAssignmentType(
  list: any,
  customerId?: string,
  customerTypeId?: string,
  supplierId?: string,
  supplierTypeId?: string
): AssignmentType {
  const assignments = list.priceListAssignment as
    | Array<{
        customerId: string | null;
        customerTypeId: string | null;
        supplierId: string | null;
        supplierTypeId: string | null;
      }>
    | undefined;

  if (!assignments || assignments.length === 0) return "global";

  const hasDirect = assignments.some(
    (a) => a.customerId === customerId || a.supplierId === supplierId
  );
  if (hasDirect) return "direct";

  const hasType = assignments.some(
    (a) =>
      (customerTypeId && a.customerTypeId === customerTypeId) ||
      (supplierTypeId && a.supplierTypeId === supplierTypeId)
  );
  if (hasType) return "type";

  return "global";
}

function specificityScore(
  assignmentType: AssignmentType,
  matchType: string | null
): number {
  // Lower score = higher specificity = wins
  const assignmentScore =
    assignmentType === "direct" ? 0 : assignmentType === "type" ? 2 : 4;
  const matchScore = matchType === "item" ? 0 : 1;
  return assignmentScore + matchScore;
}

// ============================================================
// Main Resolution
// ============================================================

export async function resolvePrice(
  client: SupabaseClient<Database>,
  companyId: string,
  input: PriceResolutionInput
): Promise<PriceResolutionResult> {
  const date = input.date ?? new Date().toISOString().split("T")[0]!;
  const trace: PriceTraceStep[] = [];

  // ---------------------------------------------------------
  // Step 1: Find applicable price lists
  // ---------------------------------------------------------
  let applicableLists: any[] = [];

  if (input.listType === "Sales" && input.customerId) {
    const { data } = await getActivePriceListsForCustomer(
      client,
      companyId,
      input.customerId,
      input.customerTypeId ?? null,
      date,
      input.currencyCode
    );
    if (data) applicableLists = data;
  } else if (input.listType === "Purchase" && input.supplierId) {
    const { data } = await getActivePriceListsForSupplier(
      client,
      companyId,
      input.supplierId,
      input.supplierTypeId ?? null,
      date,
      input.currencyCode
    );
    if (data) applicableLists = data;
  }

  // ---------------------------------------------------------
  // Step 2: Resolve base price using specificity-based resolution
  // ---------------------------------------------------------
  let basePrice: number | null = null;
  let winningListId: string | null = null;
  let winningListName: string | null = null;
  let winningPriceType: "Gross" | "Net" | "Discounted" = "Net";
  let bestScore = Infinity;
  let bestSequence = Infinity;
  let bestMatchType: string | null = null;

  for (const list of applicableLists) {
    const assignmentType = getAssignmentType(
      list,
      input.customerId,
      input.customerTypeId,
      input.supplierId,
      input.supplierTypeId
    );

    const result = await getPriceListItemsForResolution(
      client,
      list.id,
      input.itemId,
      input.itemPostingGroupId ?? null
    );

    if (result.data) {
      const score = specificityScore(assignmentType, result.matchType);
      const seq = list.sequence ?? 0;

      // Lower score wins. Within same score, lower sequence wins.
      if (score < bestScore || (score === bestScore && seq < bestSequence)) {
        const item = result.data as any;
        const breaks = (item.priceListItemBreak ?? []) as Array<{
          minQuantity: number;
          unitPrice: number;
        }>;

        if (item.pricingMethod === "Price Breaks" && breaks.length > 0) {
          // Price Breaks method: use quantity tiers exclusively
          const priceBreaks = breaks.map((b) => ({
            quantity: b.minQuantity,
            unitPrice: b.unitPrice
          }));
          // Fallback to lowest break price when qty is below all tiers
          const lowestBreak = priceBreaks.reduce((min, b) =>
            b.quantity < min.quantity ? b : min
          );
          basePrice = lookupPriceFromBreaks(
            priceBreaks,
            input.quantity,
            lowestBreak.unitPrice
          );
        } else if (item.pricingMethod === "Formula") {
          // Formula-based pricing: compute from cost or sale price
          basePrice = await computeFormulaPrice(
            client,
            input.itemId,
            item.formulaBase ?? "cost",
            item.markupPercent ?? 0,
            item.minMarginPercent
          );
        } else {
          // Fixed pricing (default)
          basePrice = item.unitPrice;
        }

        winningListId = list.id;
        winningListName = list.name;
        winningPriceType = list.priceType ?? "Net";
        bestScore = score;
        bestSequence = seq;
        bestMatchType = result.matchType;
      }
    }
  }

  // ---------------------------------------------------------
  // Step 3: Fallback base price
  // ---------------------------------------------------------
  if (basePrice === null) {
    if (input.existingBasePrice !== undefined) {
      basePrice = input.existingBasePrice;
      trace.push({
        step: "Base Price",
        source:
          input.listType === "Purchase"
            ? "Supplier Part Price (existing)"
            : "Item Unit Sale Price (fallback)",
        amount: basePrice
      });
    } else if (input.listType === "Sales") {
      const { data: salePrice } = await client
        .from("itemUnitSalePrice")
        .select("unitSalePrice")
        .eq("itemId", input.itemId)
        .maybeSingle();

      basePrice = salePrice?.unitSalePrice ?? 0;
      trace.push({
        step: "Base Price",
        source: "Item Unit Sale Price (fallback)",
        amount: basePrice
      });
    } else {
      basePrice = 0;
      trace.push({
        step: "Base Price",
        source: "No price found",
        amount: 0
      });
    }
  } else {
    trace.push({
      step: "Base Price",
      source: `Price List: ${winningListName} (${bestMatchType} match)`,
      amount: basePrice
    });
  }

  // ---------------------------------------------------------
  // Step 4: Evaluate structured rules (SQL-based, no engine)
  // ---------------------------------------------------------
  const listIdForRules = winningListId ?? applicableLists[0]?.id;

  type MatchedRule = {
    id: string;
    name: string;
    ruleType: string;
    amountType: string;
    amount: number;
  };

  let matchedRules: MatchedRule[] = [];

  if (listIdForRules) {
    const { data: rules } = await getApplicableRules(
      client,
      listIdForRules,
      input.quantity,
      input.customerTypeId ?? null,
      input.supplierTypeId ?? null,
      input.itemId,
      input.itemPostingGroupId ?? null
    );

    if (rules) {
      matchedRules = rules;
      if (!winningListId && rules.length > 0) {
        winningListId = listIdForRules;
        winningListName = applicableLists[0]?.name ?? null;
      }
    }
  }

  // ---------------------------------------------------------
  // Step 5: Apply adjustments
  // ---------------------------------------------------------
  let finalPrice = basePrice;

  const surchargeRules = matchedRules.filter((r) => r.ruleType === "Surcharge");

  // Discounted price type: skip discount rules to prevent double-discounting
  const discountRules =
    winningPriceType === "Discounted"
      ? []
      : matchedRules.filter((r) => r.ruleType === "Discount");

  if (
    winningPriceType === "Discounted" &&
    matchedRules.some((r) => r.ruleType === "Discount")
  ) {
    trace.push({
      step: "Discount",
      source: `Skipped — price list type is "Discounted" (discounts already applied)`,
      amount: finalPrice
    });
  }

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
      trace.push({
        step: "Discount",
        source: `Rule: ${bestRule.name}`,
        amount: finalPrice,
        adjustment: -bestDiscount
      });
    }
  }

  // Surcharges: all stack additively
  for (const rule of surchargeRules) {
    const adjustment =
      rule.amountType === "Percentage" ? basePrice * rule.amount : rule.amount;

    finalPrice += adjustment;
    trace.push({
      step: "Surcharge",
      source: `Rule: ${rule.name}`,
      amount: finalPrice,
      adjustment
    });
  }

  finalPrice = Math.max(0, finalPrice);

  trace.push({
    step: "Final Price",
    source: "Resolved",
    amount: finalPrice
  });

  return {
    finalPrice,
    basePrice,
    priceListId: winningListId,
    priceListName: winningListName,
    priceType: winningPriceType,
    trace
  };
}

/**
 * Batch resolution for multiple items.
 */
export async function resolvePrices(
  client: SupabaseClient<Database>,
  companyId: string,
  inputs: PriceResolutionInput[]
): Promise<Map<string, PriceResolutionResult>> {
  const results = new Map<string, PriceResolutionResult>();

  for (const input of inputs) {
    const result = await resolvePrice(client, companyId, input);
    results.set(input.itemId, result);
  }

  return results;
}
