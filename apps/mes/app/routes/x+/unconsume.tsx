import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  evaluateLinesForSurface,
  isBlocked
} from "@carbon/ee/business-rules.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { issueTrackedEntityValidator } from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const payload = await request.json();
  const validation = issueTrackedEntityValidator.safeParse(payload);

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const { materialId, parentTrackedEntityId, children } = validation.data;
  const acknowledged = Boolean(
    (payload as { acknowledged?: boolean }).acknowledged
  );

  const serviceRole = await getCarbonServiceRole();

  // materialReceive surface — return-to-stock from a job operation. Resolve
  // workCenter via jobMaterial → jobOperation. Skip rule eval if material's
  // operation is unresolvable (consistent with permissive-fallback elsewhere).
  const { data: matRow } = await serviceRole
    .from("jobMaterial")
    .select("jobOperationId, itemId, quantity")
    .eq("id", materialId)
    .maybeSingle();

  if (matRow?.jobOperationId) {
    const { data: jobOpRow } = await serviceRole
      .from("jobOperation")
      .select("workCenterId, workInstructionId")
      .eq("id", matRow.jobOperationId)
      .maybeSingle();

    if (jobOpRow?.workCenterId) {
      const ruleEval = await evaluateLinesForSurface({
        client: serviceRole,
        companyId,
        userId,
        targetType: "workCenter",
        surface: "materialReceive",
        lines: [
          {
            lineId: materialId,
            itemId: (matRow.itemId as string | null) ?? null,
            workCenterId: jobOpRow.workCenterId,
            operation: {
              id: matRow.jobOperationId,
              itemId: (matRow.itemId as string | null) ?? null,
              quantity: matRow.quantity ?? null,
              workInstructionId: jobOpRow.workInstructionId ?? null
            },
            quantity: matRow.quantity ?? 0
          }
        ]
      });
      if (
        ruleEval.violations.length > 0 &&
        isBlocked(ruleEval.violations, acknowledged)
      ) {
        return data(
          {
            success: false,
            message:
              ruleEval.violations[0]?.message ??
              "Rule violation prevented material return",
            violations: ruleEval.violations,
            ruleNames: ruleEval.ruleNames
          },
          { status: 400 }
        );
      }
    }
  }

  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      type: "unconsumeTrackedEntities",
      materialId,
      parentTrackedEntityId,
      children,
      companyId,
      userId
    }
  });

  if (issue.error) {
    console.error(issue.error);
    return data(
      { success: false, message: "Failed to issue material" },
      { status: 400 }
    );
  }

  return { success: true, message: "Material unconsumed successfully" };
}
