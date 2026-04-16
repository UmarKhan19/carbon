import { assertIsPost } from "@carbon/auth";
import { requireActiveEmployee } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  getItemForCompany,
  getLocationForCompany,
  getShelfForCompany,
  insertManualInventoryAdjustment,
  inventoryAdjustmentValidator
} from "~/services/inventory.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requireActiveEmployee(request);
  const serviceRole = await getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(inventoryAdjustmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }
  const { ...d } = validation.data;

  const [item, location, shelf] = await Promise.all([
    getItemForCompany(serviceRole, d.itemId, companyId),
    getLocationForCompany(serviceRole, d.locationId, companyId),
    d.shelfId
      ? getShelfForCompany(serviceRole, d.shelfId, companyId)
      : Promise.resolve({ data: null, error: null })
  ]);

  if (
    item.error ||
    !item.data ||
    location.error ||
    !location.data ||
    (d.shelfId && (shelf.error || !shelf.data))
  ) {
    return {
      success: false,
      message: "Access denied"
    };
  }

  const itemLedger = await insertManualInventoryAdjustment(serviceRole, {
    ...d,
    itemId: item.data.id,
    locationId: location.data.id,
    shelfId: shelf.data?.id,
    companyId,
    createdBy: userId
  });

  if (itemLedger.error) {
    const flashMessage =
      itemLedger.error.message ===
      "Insufficient quantity for negative adjustment"
        ? "Insufficient quantity for negative adjustment"
        : "Failed to create manual inventory adjustment";

    return {
      success: false,
      message: flashMessage
    };
  }

  return {
    success: true
  };
}
