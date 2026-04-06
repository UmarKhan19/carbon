import { z } from "zod";
import { zfd } from "zod-form-data";

export const priceListStatusTypes = [
  "Draft",
  "Active",
  "Expired",
  "Archived"
] as const;

export const priceListTypes = ["Sales", "Purchase"] as const;

export const priceListPriceTypes = ["Gross", "Net", "Discounted"] as const;

export const priceListRuleTypes = ["Discount", "Surcharge"] as const;

export const priceListRuleAmountTypes = ["Percentage", "Fixed"] as const;

export const pricingMethods = ["Fixed", "Formula", "Price Breaks"] as const;

export const formulaBases = ["cost", "salePrice"] as const;

export const priceListValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional()),
  type: z.enum(priceListTypes),
  status: z.enum(priceListStatusTypes).optional(),
  priceType: z.enum(priceListPriceTypes).default("Net"),
  currencyCode: zfd.text(
    z.string().min(1, { message: "Currency is required" })
  ),
  validFrom: zfd.text(z.string().optional()),
  validTo: zfd.text(z.string().optional())
});

export const priceListItemValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    priceListId: z.string().min(1),
    itemId: zfd.text(z.string().optional()),
    itemPostingGroupId: zfd.text(z.string().optional()),
    unitPrice: zfd.numeric(z.number().min(0).default(0)),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    pricingMethod: z.enum(pricingMethods).default("Fixed"),
    formulaBase: z.enum(formulaBases).optional(),
    markupPercent: zfd.numeric(z.number().min(0).optional()),
    minMarginPercent: zfd.numeric(z.number().min(0).max(1).optional())
  })
  .refine((d) => d.pricingMethod !== "Formula" || d.formulaBase, {
    message: "Base price source is required for formula pricing",
    path: ["formulaBase"]
  });

export const priceListRuleValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    priceListId: z.string().min(1),
    name: z.string().min(1, { message: "Name is required" }),
    ruleType: z.enum(priceListRuleTypes),
    amountType: z.enum(priceListRuleAmountTypes),
    amount: zfd.numeric(z.number().min(0)),
    minQuantity: zfd.numeric(z.number().min(0).optional()),
    maxQuantity: zfd.numeric(z.number().min(0).optional()),
    customerTypeId: zfd.text(z.string().optional()),
    supplierTypeId: zfd.text(z.string().optional()),
    itemId: zfd.text(z.string().optional()),
    itemPostingGroupId: zfd.text(z.string().optional()),
    active: z
      .union([z.boolean(), z.literal("on"), z.literal("off")])
      .transform((v) => v === true || v === "on")
      .default(true)
  })
  .refine((d) => d.amountType !== "Percentage" || d.amount <= 1, {
    message: "Percentage must be between 0% and 100%",
    path: ["amount"]
  });

export const priceListAssignmentValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    priceListId: z.string().min(1),
    customerId: zfd.text(z.string().optional()),
    customerTypeId: zfd.text(z.string().optional()),
    supplierId: zfd.text(z.string().optional()),
    supplierTypeId: zfd.text(z.string().optional())
  })
  .refine(
    (d) =>
      !!(d.customerId || d.customerTypeId || d.supplierId || d.supplierTypeId),
    {
      message: "Select a customer, customer type, supplier, or supplier type",
      path: ["customerId"]
    }
  );
