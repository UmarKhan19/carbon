import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  getBusinessRules,
  getRuleAssignmentCounts
} from "~/modules/businessRules";
import BusinessRulesGroups from "~/modules/businessRules/ui/BusinessRulesGroups";
import BusinessRulesUpgradeOverlay from "~/modules/businessRules/ui/BusinessRulesUpgradeOverlay";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Business Rules`,
  to: path.to.businessRules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const rules = await getBusinessRules(client, companyId, {
    search: null,
    limit: 1000,
    offset: 0,
    sorts: []
  });

  if (rules.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(rules.error, "Failed to load business rules"))
    );
  }

  const ids = (rules.data ?? []).map((r) => r.id);
  const counts = await getRuleAssignmentCounts(client, ids);

  const rows = (rules.data ?? []).map((r) => ({
    ...r,
    assignmentCount: counts.data?.[r.id] ?? 0
  }));

  return { rows };
}

export default function BusinessRulesSettingsRoute() {
  const { rows } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "BUSINESS_RULES" });

  if (isGated) {
    return <BusinessRulesUpgradeOverlay />;
  }

  return (
    <>
      <BusinessRulesGroups rules={rows as never} />
      <Outlet />
    </>
  );
}
