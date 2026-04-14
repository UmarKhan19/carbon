import type { getPricingRule, getPricingRules } from "./pricing.service";

export type PricingRule = NonNullable<
  Awaited<ReturnType<typeof getPricingRules>>["data"]
>[number];

export type PricingRuleDetail = NonNullable<
  Awaited<ReturnType<typeof getPricingRule>>["data"]
>;
