import { z } from "zod";
import { zfd } from "zod-form-data";
import { macrsConventions, macrsPropertyClasses } from "./macrs";

export const fixedAssetStatuses = [
  "Draft",
  "Active",
  "Fully Depreciated",
  "Disposed"
] as const;

export const depreciationMethods = [
  "Straight Line",
  "Declining Balance",
  "Units of Production"
] as const;

export const taxDepreciationMethods = [
  "Straight Line",
  "Declining Balance",
  "MACRS"
] as const;

export const disposalMethods = ["Sale", "Scrapping"] as const;

export const fixedAssetClassValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  depreciationMethod: z.enum(depreciationMethods, {
    errorMap: () => ({ message: "Depreciation method is required" })
  }),
  usefulLifeMonths: zfd.numeric(
    z.number().int().positive({ message: "Useful life must be positive" })
  ),
  residualValuePercent: zfd.numeric(
    z
      .number()
      .min(0, { message: "Residual value must be >= 0" })
      .max(100, { message: "Residual value must be <= 100" })
  ),
  assetAccountId: z.string().min(1, { message: "Asset account is required" }),
  accumulatedDepreciationAccountId: z
    .string()
    .min(1, { message: "Accumulated depreciation account is required" }),
  depreciationExpenseAccountId: z
    .string()
    .min(1, { message: "Depreciation expense account is required" }),
  writeOffAccountId: z
    .string()
    .min(1, { message: "Write-off account is required" }),
  writeDownAccountId: z
    .string()
    .min(1, { message: "Write-down account is required" }),
  disposalAccountId: z
    .string()
    .min(1, { message: "Disposal account is required" }),
  taxDepreciationMethod: z.preprocess(
    (val) => (val === "" ? null : val),
    z.enum(taxDepreciationMethods).nullable().optional()
  ),
  taxUsefulLifeMonths: zfd.numeric(
    z.number().int().positive().nullable().optional()
  ),
  taxResidualValuePercent: zfd.numeric(
    z.number().min(0).max(100).nullable().optional()
  ),
  macrsPropertyClass: z.enum(macrsPropertyClasses).nullable().optional(),
  macrsConvention: z.enum(macrsConventions).nullable().optional(),
  bonusDepreciationPercent: zfd.numeric(
    z.number().min(0).max(100).nullable().optional()
  )
});

export const fixedAssetValidator = z.object({
  id: zfd.text(z.string().optional()),
  fixedAssetClassId: z.string().min(1, { message: "Asset class is required" }),
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  serialNumber: z.string().optional(),
  depreciationMethod: z.enum(depreciationMethods, {
    errorMap: () => ({ message: "Depreciation method is required" })
  }),
  usefulLifeMonths: zfd.numeric(
    z.number().int().positive({ message: "Useful life must be positive" })
  ),
  residualValuePercent: zfd.numeric(
    z
      .number()
      .min(0, { message: "Residual value must be >= 0" })
      .max(100, { message: "Residual value must be <= 100" })
  ),
  assetLifetimeUsage: zfd.numeric(z.number().positive().optional()),
  locationId: zfd.text(z.string().optional()),
  custodianId: zfd.text(z.string().optional())
});

export const fixedAssetRegisterValidator = z.object({
  acquisitionCost: zfd.numeric(
    z.number().positive({ message: "Acquisition cost must be positive" })
  ),
  acquisitionDate: z
    .string()
    .min(1, { message: "Acquisition date is required" }),
  accumulatedDepreciation: zfd.numeric(
    z.number().min(0, { message: "Accumulated depreciation must be >= 0" })
  ),
  depreciationStartDate: z
    .string()
    .min(1, { message: "Depreciation start date is required" })
});

export const depreciationRunValidator = z.object({
  periodEnd: z.string().min(1, { message: "Period end date is required" })
});

export const fixedAssetUsageLogValidator = z.object({
  fixedAssetId: z.string().min(1, { message: "Asset is required" }),
  periodStart: z.string().min(1, { message: "Period start is required" }),
  periodEnd: z.string().min(1, { message: "Period end is required" }),
  unitsProduced: zfd.numeric(
    z.number().positive({ message: "Units must be positive" })
  )
});

export const fixedAssetDisposalValidator = z.object({
  disposalDate: z.string().min(1, { message: "Disposal date is required" })
});
