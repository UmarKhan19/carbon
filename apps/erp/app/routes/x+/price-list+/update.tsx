import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import {
  checkOverlappingPriceLists,
  getPriceList,
  syncPriceListAssignments
} from "~/modules/pricing";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const formData = await request.formData();
  const id = formData.get("id");
  const field = formData.get("field");

  if (typeof id !== "string" || typeof field !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  // Sync assignments (multi-select from Properties panel)
  if (field === "assignments") {
    const customerIds = formData.getAll("customerIds") as string[];
    const customerTypeIds = formData.getAll("customerTypeIds") as string[];
    const supplierIds = formData.getAll("supplierIds") as string[];
    const supplierTypeIds = formData.getAll("supplierTypeIds") as string[];

    const result = await syncPriceListAssignments(
      client,
      id,
      companyId,
      userId,
      { customerIds, customerTypeIds, supplierIds, supplierTypeIds }
    );

    if (result.error) {
      return { error: { message: result.error.message }, data: null };
    }
    return { data: null, error: null };
  }

  // Single-field updates
  const value = formData.get("value");
  if (typeof value !== "string" && value !== null) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  const allowedFields = [
    "name",
    "description",
    "status",
    "priceType",
    "currencyCode",
    "validFrom",
    "validTo"
  ];

  if (!allowedFields.includes(field)) {
    return { error: { message: `Invalid field: ${field}` }, data: null };
  }

  if (field === "name" && !value) {
    return { error: { message: "Name is required" }, data: null };
  }

  // Check for overlapping price lists when activating
  if (field === "status" && value === "Active") {
    const { data: current } = await getPriceList(client, id);
    if (current && current.status !== "Active") {
      const { overlapping } = await checkOverlappingPriceLists(
        client,
        companyId,
        id,
        current.type as "Sales" | "Purchase",
        current.validFrom,
        current.validTo
      );

      if (overlapping.length > 0) {
        const names = overlapping.map((o) => o.name).join(", ");
        return {
          error: {
            message: `Cannot activate: overlapping dates with: ${names}. Adjust dates, assignments, or deactivate the conflicting list.`
          },
          data: null
        };
      }
    }
  }

  return client
    .from("priceList")
    .update({
      [field]: value || null,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id);
}
