import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import {
  getPriceListLockState,
  syncPriceListAssignments
} from "~/modules/pricing";

// Fields that affect pricing and are blocked when the list is Active.
// Name, description, and status are NOT in this list — name/description
// are just labels, and status is the escape hatch (you change it to Draft
// to unlock the rest).
const PRICING_FIELDS = new Set([
  "priceType",
  "currencyCode",
  "validFrom",
  "validTo"
]);

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
    const { isLocked } = await getPriceListLockState(client, id);
    if (isLocked) {
      return {
        error: {
          message:
            "Price list is Active. Create a new version before changing assignments."
        },
        data: null
      };
    }

    const customerIds = formData.getAll("customerIds") as string[];
    const customerTypeIds = formData.getAll("customerTypeIds") as string[];
    const supplierIds = formData.getAll("supplierIds") as string[];
    const supplierTypeIds = formData.getAll("supplierTypeIds") as string[];

    const result = await syncPriceListAssignments(id, companyId, userId, {
      customerIds,
      customerTypeIds,
      supplierIds,
      supplierTypeIds
    });

    if (result.error) {
      return { error: { message: result.error.message }, data: null };
    }
    return { data: null, error: null };
  }

  // Block pricing-affecting field edits when the list is Active
  if (PRICING_FIELDS.has(field)) {
    const { isLocked } = await getPriceListLockState(client, id);
    if (isLocked) {
      return {
        error: {
          message:
            "Price list is Active. Create a new version before changing pricing fields."
        },
        data: null
      };
    }
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

  return client
    .from("priceList")
    .update({
      [field]: value || null,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id);
}
