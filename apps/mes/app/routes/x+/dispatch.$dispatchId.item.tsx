import { assertIsPost, error, success } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getItemForCompany } from "~/services/inventory.service";
import {
  addMaintenanceDispatchItem,
  getMaintenanceDispatchForCompany,
  getMaintenanceDispatchItemForDispatch
} from "~/services/maintenance.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requireActiveEmployee(request);
  const { dispatchId } = params;

  if (!dispatchId) {
    return data({}, await flash(request, error("Dispatch ID is required")));
  }

  const formData = await request.formData();
  const action = formData.get("action") as "add" | "delete";

  const serviceRole = await getCarbonServiceRole();
  const dispatch = await getMaintenanceDispatchForCompany(
    serviceRole,
    dispatchId,
    companyId
  );

  if (dispatch.error || !dispatch.data) {
    return data(
      {},
      await flash(request, error(dispatch.error, "Access Denied"))
    );
  }

  if (action === "add") {
    const itemId = formData.get("itemId") as string;
    const quantity = Number(formData.get("quantity"));
    const unitOfMeasureCode = formData.get("unitOfMeasureCode") as string;

    if (!itemId) {
      return data({}, await flash(request, error("Item is required")));
    }

    if (!quantity || quantity <= 0) {
      return data(
        {},
        await flash(request, error("Valid quantity is required"))
      );
    }

    const item = await getItemForCompany(serviceRole, itemId, companyId);

    if (item.error || !item.data) {
      return data({}, await flash(request, error(item.error, "Access Denied")));
    }

    const result = await addMaintenanceDispatchItem(serviceRole, {
      maintenanceDispatchId: dispatch.data.id,
      itemId: item.data.id,
      quantity,
      unitOfMeasureCode: unitOfMeasureCode || "EA",
      companyId,
      createdBy: userId
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to add spare part"))
      );
    }

    return data(
      { id: result.data?.id },
      await flash(request, success("Spare part added"))
    );
  }

  if (action === "delete") {
    const itemId = formData.get("itemId") as string;

    if (!itemId) {
      return data({}, await flash(request, error("Item ID is required")));
    }

    const dispatchItem = await getMaintenanceDispatchItemForDispatch(
      serviceRole,
      itemId,
      dispatch.data.id,
      companyId
    );

    if (dispatchItem.error || !dispatchItem.data) {
      return data(
        {},
        await flash(request, error(dispatchItem.error, "Access Denied"))
      );
    }

    const result = await serviceRole.functions.invoke("issue", {
      body: {
        type: "maintenanceDispatchUnissue",
        maintenanceDispatchItemId: dispatchItem.data.id,
        companyId,
        userId
      },
      region: FunctionRegion.UsEast1
    });

    if (result.error) {
      return data(
        {},
        await flash(request, error(result.error, "Failed to remove spare part"))
      );
    }

    return data(
      {},
      await flash(
        request,
        success("Spare part removed and returned to inventory")
      )
    );
  }

  return data({});
}
