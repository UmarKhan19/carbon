import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { ApprovalRules } from "~/modules/settings";
import {
  getCompanySettings,
  updateSupplierApprovalSetting
} from "~/modules/settings/settings.service";
import { getApprovalRules } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Approval Rules`,
  to: path.to.approvalRules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const serviceRole = getCarbonServiceRole();

  const [rules, groupsResult, companySettings] = await Promise.all([
    getApprovalRules(serviceRole, companyId),
    client
      .from("group")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("isCustomerOrgGroup", false)
      .eq("isSupplierOrgGroup", false),
    getCompanySettings(client, companyId)
  ]);

  if (rules.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(rules.error, "Failed to load approval rules"))
    );
  }

  if (companySettings.error) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to load company settings")
      )
    );
  }

  const groupMap = new Map(
    (groupsResult.data || []).map((g) => [g.id, g.name])
  );

  const enrichedRules = (rules.data || []).map((rule) => ({
    ...rule,
    approverGroupNames: rule.approverGroupIds
      ? rule.approverGroupIds
          .map((id) => groupMap.get(id))
          .filter((name): name is string => !!name)
      : []
  }));

  const poRules = enrichedRules
    .filter((r) => r.documentType === "purchaseOrder")
    .sort((a, b) => (a.lowerBoundAmount ?? 0) - (b.lowerBoundAmount ?? 0));

  const qdRules = enrichedRules.filter(
    (r) => r.documentType === "qualityDocument"
  );

  const supplierRules = enrichedRules.filter(
    (r) => r.documentType === "supplier"
  );

  return {
    poRules,
    qdRules,
    supplierRules,
    supplierApprovalEnabled: companySettings.data.supplierApproval ?? false
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggleSupplierApproval") {
    const enabled = formData.get("enabled") === "true";
    const result = await updateSupplierApprovalSetting(
      client,
      companyId,
      enabled
    );

    if (result.error) {
      return { success: false, message: result.error.message };
    }

    return { success: true };
  }

  return { success: false, message: "Unknown intent" };
}

export default function ApprovalSettingsRoute() {
  const { poRules, qdRules, supplierRules, supplierApprovalEnabled } =
    useLoaderData<typeof loader>();

  return (
    <>
      <ApprovalRules
        poRules={poRules}
        qdRules={qdRules}
        supplierRules={supplierRules}
        supplierApprovalEnabled={supplierApprovalEnabled}
      />
      <Outlet />
    </>
  );
}
