import { assertIsPost } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getItemForCompany } from "~/services/inventory.service";
import { getMaintenanceDispatchForCompany } from "~/services/maintenance.service";
import { getTrackedEntitiesForCompany } from "~/services/operations.service";

const addAndIssueValidator = z.object({
  itemId: z.string().min(1),
  unitOfMeasureCode: z.string().min(1),
  // For inventory items
  quantity: z.number().optional(),
  // For tracked items (serial/batch)
  children: z
    .array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number()
      })
    )
    .optional()
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requireActiveEmployee(request);
  const { dispatchId } = params;

  if (!dispatchId) {
    return data(
      { success: false, message: "Dispatch ID is required" },
      { status: 400 }
    );
  }

  const json = await request.json();
  const validation = addAndIssueValidator.safeParse(json);

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const { itemId, unitOfMeasureCode, quantity, children } = validation.data;

  // Calculate total quantity from children if provided, otherwise use quantity
  const totalQuantity = children
    ? children.reduce((sum, c) => sum + c.quantity, 0)
    : (quantity ?? 0);

  if (totalQuantity <= 0) {
    return data(
      { success: false, message: "Quantity must be greater than 0" },
      { status: 400 }
    );
  }

  const serviceRole = await getCarbonServiceRole();
  const [dispatch, item, trackedEntities] = await Promise.all([
    getMaintenanceDispatchForCompany(serviceRole, dispatchId, companyId),
    getItemForCompany(serviceRole, itemId, companyId),
    children && children.length > 0
      ? getTrackedEntitiesForCompany(
          serviceRole,
          children.map((child) => child.trackedEntityId),
          companyId
        )
      : Promise.resolve({ data: [], error: null })
  ]);

  if (
    dispatch.error ||
    !dispatch.data ||
    item.error ||
    !item.data ||
    trackedEntities.error ||
    trackedEntities.data.length !== (children?.length ?? 0)
  ) {
    return data({ success: false, message: "Access denied" }, { status: 403 });
  }

  if (children && children.length > 0) {
    // Tracked entities (serial/batch)
    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        type: "maintenanceDispatchTrackedEntities",
        maintenanceDispatchId: dispatch.data.id,
        itemId: item.data.id,
        unitOfMeasureCode,
        children,
        companyId,
        userId
      },
      region: FunctionRegion.UsEast1
    });

    if (issue.error) {
      console.error(issue.error);
      return data(
        { success: false, message: "Failed to issue tracked items" },
        { status: 400 }
      );
    }
  } else {
    // Inventory item
    const issue = await serviceRole.functions.invoke("issue", {
      body: {
        type: "maintenanceDispatchInventory",
        maintenanceDispatchId: dispatch.data.id,
        itemId: item.data.id,
        unitOfMeasureCode,
        quantity: totalQuantity,
        companyId,
        userId
      },
      region: FunctionRegion.UsEast1
    });

    if (issue.error) {
      console.error(issue.error);
      return data(
        { success: false, message: "Failed to issue from inventory" },
        { status: 400 }
      );
    }
  }

  return {
    success: true,
    message: "Part added and issued successfully"
  };
}
