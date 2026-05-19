import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getBusinessRulesDataForTarget } from "@carbon/ee/business-rules.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import RuleAssignmentsList from "~/modules/businessRules/ui/RuleAssignmentsList";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });
  const { workCenterId } = params;
  if (!workCenterId) throw notFound("workCenterId required");

  const data = await getBusinessRulesDataForTarget(client, {
    targetType: "workCenter",
    targetId: workCenterId,
    companyId
  });

  return { workCenterId, ...data };
}

export default function WorkCenterRulesRoute() {
  const { workCenterId, assignments, library } = useLoaderData<typeof loader>();
  return (
    <RuleAssignmentsList
      targetType="workCenter"
      targetId={workCenterId}
      assignments={assignments as never}
      library={library as never}
    />
  );
}
