import { z } from "zod";
import { zfd } from "zod-form-data";

export const pricingRuleTypes = ["Discount", "Markup"] as const;
export const pricingRuleAmountTypes = ["Percentage", "Fixed"] as const;

export const pricingRuleValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    ruleType: z.enum(pricingRuleTypes),
    amountType: z.enum(pricingRuleAmountTypes),
    amount: zfd.numeric(z.number().min(0)),
    minQuantity: zfd.numeric(z.number().min(0).optional()),
    maxQuantity: zfd.numeric(z.number().min(0).optional()),
    customerIds: z.array(z.string()).optional(),
    customerTypeIds: z.array(z.string()).optional(),
    itemIds: z.array(z.string()).optional(),
    itemPostingGroupId: zfd.text(z.string().optional()),
    validFrom: zfd.text(z.string().optional()),
    validTo: zfd.text(z.string().optional()),
    formulaBase: zfd.text(z.string().optional()),
    minMarginPercent: zfd.numeric(z.number().min(0).max(1).optional()),
    active: z
      .union([z.boolean(), z.literal("on"), z.literal("off")])
      .transform((v) => v === true || v === "on")
      .default(true)
  })
  .refine((d) => d.amountType !== "Percentage" || d.amount <= 1, {
    message: "Percentage must be between 0% and 100%",
    path: ["amount"]
  })
  .refine((d) => !d.validFrom || !d.validTo || d.validFrom <= d.validTo, {
    message: "Valid From must be on or before Valid To",
    path: ["validTo"]
  });

export const priceResolutionInputValidator = z.object({
  itemId: z.string().min(1),
  quantity: z.number().nonnegative(),
  customerId: z.string().optional(),
  customerTypeId: z.string().optional(),
  itemPostingGroupId: z.string().optional(),
  date: z.string().optional(),
  existingBasePrice: z.number().optional()
});
