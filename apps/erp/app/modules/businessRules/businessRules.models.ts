import {
  SURFACES_BY_TARGET_TYPE,
  TARGET_TYPES,
  TRANSACTION_SURFACES
} from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";

export const businessRuleSeverities = ["error", "warn"] as const;

export const businessRuleOperators = [
  "eq",
  "neq",
  "in",
  "notIn",
  "isSet",
  "isNotSet",
  "gt",
  "lt"
] as const;

const businessRuleConditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
  z.null()
]);

const businessRuleConditionSchema = z.object({
  field: z.string().min(1, { message: "Field is required" }),
  op: z.enum(businessRuleOperators),
  value: businessRuleConditionValueSchema.optional()
});

export const businessRuleMatchKinds = ["all", "any", "none"] as const;

export const businessRuleConditionAstSchema = z.object({
  kind: z.enum(businessRuleMatchKinds),
  conditions: z
    .array(businessRuleConditionSchema)
    .min(1, { message: "At least one condition is required" })
});

const businessRuleConditionAstFormField = z.preprocess((raw) => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}, businessRuleConditionAstSchema);

export const businessRuleValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }).max(120),
    description: zfd.text(z.string().optional()),
    message: z.string().min(1, { message: "Message is required" }).max(500),
    severity: z.enum(businessRuleSeverities),
    targetType: z.enum(TARGET_TYPES),
    appliesToAll: zfd.checkbox(),
    active: zfd.checkbox(),
    surfaces: zfd
      .repeatableOfType(z.enum(TRANSACTION_SURFACES))
      .refine((arr) => arr.length >= 1, {
        message: "Pick at least one surface"
      }),
    conditionAst: businessRuleConditionAstFormField
  })
  .superRefine((val, ctx) => {
    // Reject any surface that isn't valid for the chosen targetType. Schema
    // enforcement only — DB has no CHECK; UI also filters the picker.
    const allowed = new Set<string>(SURFACES_BY_TARGET_TYPE[val.targetType]);
    for (let i = 0; i < val.surfaces.length; i++) {
      const s = val.surfaces[i]!;
      if (!allowed.has(s)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["surfaces", i],
          message: `Surface "${s}" not valid for ${val.targetType} rules`
        });
      }
    }
  });

/**
 * Polymorphic assignment validator factory. The form's hidden field tells the
 * action which targetType is in play, then this validator picks the right
 * target-id key.
 */
export const businessRuleAssignmentValidator = (
  targetType: "item" | "storageUnit" | "workCenter"
) => {
  const idKey =
    targetType === "item"
      ? "itemId"
      : targetType === "storageUnit"
        ? "storageUnitId"
        : "workCenterId";
  return z.object({
    [idKey]: z.string().min(1, { message: "Target ID is required" }),
    ruleId: z.string().min(1, { message: "Rule ID is required" })
  });
};

export const businessRuleAcknowledgeValidator = zfd.checkbox();
