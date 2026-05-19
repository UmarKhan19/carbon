import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getBusinessRulesDataForTarget } from "@carbon/ee/business-rules.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import RuleAssignmentsList from "~/modules/businessRules/ui/RuleAssignmentsList";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });
  const { storageUnitId } = params;
  if (!storageUnitId) throw notFound("storageUnitId required");

  const data = await getBusinessRulesDataForTarget(client, {
    targetType: "storageUnit",
    targetId: storageUnitId,
    companyId
  });

  return { storageUnitId, ...data };
}

export default function StorageUnitRulesRoute() {
  const { storageUnitId, assignments, library } =
    useLoaderData<typeof loader>();
  return (
    <RuleAssignmentsList
      targetType="storageUnit"
      targetId={storageUnitId}
      assignments={assignments as never}
      library={library as never}
    />
  );
}
