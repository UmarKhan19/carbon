import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { NotificationEvent } from "@carbon/notifications";
import { tasks } from "@trigger.dev/sdk";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { SupplierDetail } from "~/modules/purchasing";
import { supplierValidator, upsertSupplier } from "~/modules/purchasing";
import SupplierForm from "~/modules/purchasing/ui/Supplier/SupplierForm";
import { getCompanySettings } from "~/modules/settings";
import {
  createApprovalRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  hasPendingApproval,
  isApprovalRequired
} from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();

  // Normal supplier update flow
  const settings = await getCompanySettings(client, companyId);
  const supplierApprovalRequired = settings.data?.supplierApproval ?? false;

  const validation = await validator(supplierValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;

  if (!id) {
    throw redirect(
      path.to.suppliers,
      await flash(request, error(null, "Failed to update supplier"))
    );
  }

  // If approval is required and status is being set to Active, intercept
  if (supplierApprovalRequired && d.supplierStatus === "Active") {
    const serviceRole = getCarbonServiceRole();
    const approvalRequired = await isApprovalRequired(
      serviceRole,
      "supplier",
      companyId,
      undefined
    );

    if (approvalRequired) {
      const pending = await hasPendingApproval(serviceRole, "supplier", id);

      if (!pending) {
        // Set status to Pending instead of Active
        d.supplierStatus = "Pending";

        const update = await upsertSupplier(client, {
          id,
          ...d,
          updatedBy: userId,
          customFields: setCustomFields(formData)
        });

        if (update.error) {
          throw redirect(
            path.to.suppliers,
            await flash(
              request,
              error(update.error, "Failed to update supplier")
            )
          );
        }

        // Create approval request
        await createApprovalRequest(serviceRole, {
          documentType: "supplier",
          documentId: id,
          companyId,
          requestedBy: userId,
          createdBy: userId,
          amount: undefined
        });

        const rule = await getApprovalRuleByAmount(
          serviceRole,
          "supplier",
          companyId,
          undefined
        );
        const approverIds = rule.data
          ? await getApproverUserIdsForRule(serviceRole, rule.data)
          : [];

        if (approverIds.length > 0) {
          try {
            await tasks.trigger("notify", {
              event: NotificationEvent.ApprovalRequested,
              companyId,
              documentId: id,
              documentType: "supplier",
              recipient: { type: "users", userIds: approverIds },
              from: userId
            });
          } catch (e) {
            console.error("Failed to trigger approval notification", e);
          }
        }

        return data(
          null,
          await flash(request, success("Supplier submitted for approval"))
        );
      }
    }
  }

  const update = await upsertSupplier(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (update.error) {
    throw redirect(
      path.to.suppliers,
      await flash(request, error(update.error, "Failed to update supplier"))
    );
  }

  return data(null, await flash(request, success("Updated supplier")));
}

export default function SupplierEditRoute() {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("Could not find supplierId");
  const routeData = useRouteData<{ supplier: SupplierDetail }>(
    path.to.supplier(supplierId)
  );

  if (!routeData?.supplier) return null;

  const initialValues = {
    id: routeData?.supplier?.id ?? undefined,
    name: routeData?.supplier?.name ?? "",
    supplierTypeId: routeData?.supplier?.supplierTypeId ?? undefined,
    supplierStatus: routeData?.supplier?.status as "Active",
    accountManagerId: routeData?.supplier?.accountManagerId ?? undefined,
    taxId: routeData?.supplier?.taxId ?? "",
    vatNumber: routeData?.supplier?.vatNumber ?? "",
    currencyCode: routeData?.supplier?.currencyCode ?? undefined,
    website: routeData?.supplier?.website ?? "",
    purchasingContactId: routeData?.supplier?.purchasingContactId ?? undefined,
    defaultCc: routeData?.supplier?.defaultCc ?? [],
    ...getCustomFields(routeData?.supplier?.customFields)
  };

  return <SupplierForm key={initialValues.id} initialValues={initialValues} />;
}
