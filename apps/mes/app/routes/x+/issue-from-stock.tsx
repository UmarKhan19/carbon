import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { recordCut } from "~/services/operations.service";

const issueFromStockValidator = z.object({
  sourceStockId: z.string().min(1, "Source stock ID is required"),
  consumedAmount: z.number().nonnegative("Consumed amount cannot be negative"),
  remnantDimensions: z.object({
    length: z.number().nonnegative(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative()
  }).optional(),
  jobMaterialId: z.string().optional()
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

  const { sourceStockId, consumedAmount, remnantDimensions, jobMaterialId } = validation.data;

  try {
    const result = await recordCut(client, {
      sourceStockId,
      consumedAmount,
      remnantDimensions,
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
          (currentMaterial?.quantityIssued ?? 0) + consumedAmount;

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

    return data({
      success: true,
      message: result.remnantId
        ? `Material issued. Remnant created with ${result.remnantId.slice(0, 10)}...`
        : "Material fully consumed from stock",
      remnantId: result.remnantId,
      activityId: result.activityId
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to issue from stock";
    console.error("Issue from stock error:", err);
    return data({ success: false, message }, { status: 500 });
  }
}
