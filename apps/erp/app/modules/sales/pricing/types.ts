import type { getPricingRule, getPricingRules } from "./pricing.service";

export type PricingRule = NonNullable<
  Awaited<ReturnType<typeof getPricingRules>>["data"]
>[number];

export type PricingRuleDetail = NonNullable<
  Awaited<ReturnType<typeof getPricingRule>>["data"]
>;

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

export type OverrideEntry = {
  overridePrice: number;
  notes: string | null;
  validFrom: string | null;
  validTo: string | null;
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
