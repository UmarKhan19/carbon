import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { recordCut } from "~/services/operations.service";

const issueFromStockValidator = z.object({
  sourceStockId: z.string().min(1, "Source stock ID is required"),
  consumedAmount: z.number().nonnegative("Consumed amount cannot be negative").optional(),
  remnantDimensions: z.object({
    length: z.number().nonnegative(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative()
  }).optional(),
  planned: z.object({
    consumedAmount: z.number().nonnegative().optional(),
    note: z.string().optional()
  }).optional(),
  actual: z.object({
    consumedAmount: z.number().nonnegative(),
    varianceReason: z.string().optional(),
    note: z.string().optional()
  }).optional(),
  outputs: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("remnant"),
        quantity: z.number().int().positive().optional(),
        dimensions: z.object({
          length: z.number().nonnegative(),
          width: z.number().nonnegative(),
          height: z.number().nonnegative()
        }),
        note: z.string().optional()
      }),
      z.object({
        kind: z.literal("scrap"),
        consumedAmount: z.number().nonnegative().optional(),
        note: z.string().optional()
      })
    ])
  ).optional(),
  jobMaterialId: z.string().optional()
}).superRefine((value, ctx) => {
  if (value.actual?.consumedAmount === undefined && value.consumedAmount === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["actual", "consumedAmount"],
      message: "Actual consumed amount is required"
    });
  }
});

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId, client } = await requirePermissions(request, {});

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = issueFromStockValidator.safeParse(body);

  if (!validation.success) {
    return data(
      {
        success: false,
        message: validation.error.errors.map((e) => e.message).join(", ")
      },
      { status: 400 }
    );
  }

  const { sourceStockId, jobMaterialId } = validation.data;
  const normalizedActual =
    validation.data.actual ?? {
      consumedAmount: validation.data.consumedAmount ?? 0
    };
  const normalizedPlanned =
    validation.data.planned ??
    (validation.data.consumedAmount !== undefined
      ? { consumedAmount: validation.data.consumedAmount }
      : undefined);
  const normalizedOutputs =
    validation.data.outputs ??
    (validation.data.remnantDimensions
      ? [
          {
            kind: "remnant" as const,
            quantity: 1,
            dimensions: validation.data.remnantDimensions
          }
        ]
      : []);

  try {
    const result = await recordCut(client, {
      sourceStockId,
      consumedAmount: normalizedActual.consumedAmount,
      remnantDimensions: validation.data.remnantDimensions,
      planned: normalizedPlanned,
      actual: normalizedActual,
      outputs: normalizedOutputs,
      jobMaterialId,
      companyId,
      userId
    });

    // If there's a jobMaterialId, update the quantityIssued on the job material
    if (jobMaterialId) {
      // Get current quantity issued
      const { data: currentMaterial, error: fetchError } = await client
        .from("jobMaterial")
        .select("quantityIssued")
        .eq("id", jobMaterialId)
        .single();

      if (fetchError) {
        console.warn(
          `Failed to fetch job material: ${fetchError.message}`
        );
      } else {
        const newQuantityIssued =
          (currentMaterial?.quantityIssued ?? 0) + normalizedActual.consumedAmount;

        const { error: updateError } = await client
          .from("jobMaterial")
          .update({ quantityIssued: newQuantityIssued })
          .eq("id", jobMaterialId);

        if (updateError) {
          console.warn(
            `Failed to update job material quantity issued: ${updateError.message}`
          );
        }
      }
    }

    const remnantIds =
      result.remnantIds ?? (result.remnantId ? [result.remnantId] : []);

    return data({
      success: true,
      message: remnantIds.length > 0
        ? remnantIds.length === 1
          ? `Material issued. Remnant created with ${remnantIds[0].slice(0, 10)}...`
          : `Material issued. ${remnantIds.length} remnants created.`
        : "Material fully consumed from stock",
      remnantId: result.remnantId,
      remnantIds,
      activityId: result.activityId
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to issue from stock";
    console.error("Issue from stock error:", err);
    return data({ success: false, message }, { status: 500 });
  }
}
