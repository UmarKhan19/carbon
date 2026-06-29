import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { isChangeOrderLocked } from "~/modules/items";
import { requireUnlockedBulk } from "~/utils/lockedGuard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "plm"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  // Per-ID locked check
  const changeOrders = await client
    .from("changeOrder")
    .select("id, status")
    .in("id", ids as string[]);

  const lockedError = requireUnlockedBulk({
    statuses: (changeOrders.data ?? []).map((c) => c.status),
    checkFn: isChangeOrderLocked,
    message: "Cannot modify a released or cancelled change order."
  });
  if (lockedError) return lockedError;

  switch (field) {
    case "requiredActionIds":
    case "approvalRequirements": {
      const arrayValue = value ? value.split(",") : [];
      const update = await client
        .from("changeOrder")
        .update({
          [field]: arrayValue,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);

      if (update.error) {
        console.error(update.error);
        return {
          error: { message: "Failed to update change order" },
          data: null
        };
      }

      return { data: update.data };
    }
    case "description": {
      // JSON NOT NULL column — never write null. Store a parsed doc when the
      // value is JSON, else fall back to an empty doc (matching insertChangeOrder).
      let parsed: unknown = {};
      if (value) {
        try {
          parsed = JSON.parse(value);
        } catch {
          parsed = value;
        }
      }
      return await client
        .from("changeOrder")
        .update({
          description: parsed as never,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    }
    case "name":
    case "type":
    case "approvalType":
    case "openDate": {
      // NOT NULL columns — reject an empty value instead of writing null.
      if (!value) {
        return { error: { message: `${field} is required` }, data: null };
      }
      return await client
        .from("changeOrder")
        .update({
          [field]: value,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    }
    case "priority":
    case "changeOrderTypeId":
    case "dueDate":
    case "effectiveDate":
      return await client
        .from("changeOrder")
        .update({
          [field]: value ? value : null,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[]);
    default:
      return {
        error: { message: `Invalid field: ${field}` },
        data: null
      };
  }
}
