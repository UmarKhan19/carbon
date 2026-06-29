import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import {
  attachAffectedItem,
  canEditChangeOrderItems,
  changeOrderDisposition,
  getChangeOrder,
  removeAffectedItem
} from "~/modules/items";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "add": {
      const changeOrderId = formData.get("changeOrderId");
      const itemId = formData.get("itemId");
      if (typeof changeOrderId !== "string" || !changeOrderId) {
        return { error: { message: "Change order is required" }, data: null };
      }
      if (typeof itemId !== "string" || !itemId) {
        return { error: { message: "Item is required" }, data: null };
      }

      const changeOrder = await getChangeOrder(
        client,
        changeOrderId,
        companyId
      );
      if (changeOrder.error || !changeOrder.data) {
        return { error: { message: "Change order not found" }, data: null };
      }
      // Affected items may only be added while the CO is a Draft. Once it is In
      // Review or later the set is frozen so a new item can't ride to release
      // unreviewed.
      if (!canEditChangeOrderItems(changeOrder.data.status)) {
        return {
          error: {
            message:
              "Affected items can only be added while the change order is a draft."
          },
          data: null
        };
      }

      // Shared attach path: runs the one-open-CO-per-item guard, inserts the
      // association, and (for Engineering COs) stages a pending revision.
      const attached = await attachAffectedItem(client, {
        changeOrderId,
        itemId,
        userId,
        companyId,
        type: changeOrder.data.type
      });

      if (attached.error || !attached.data) {
        console.error(attached.error);
        return {
          error: attached.error ?? { message: "Failed to add affected item" },
          data: null
        };
      }

      return { data: attached.data, error: null };
    }
    case "delete": {
      const id = formData.get("id");
      if (typeof id !== "string" || !id) {
        return { error: { message: "Item is required" }, data: null };
      }

      const removal = await removeAffectedItem(client, { id, companyId });
      if (removal.error) {
        return { error: removal.error, data: null };
      }

      return { data: null, error: null };
    }
    case "disposition": {
      const id = formData.get("id");
      const value = formData.get("value");
      if (typeof id !== "string" || !id) {
        return { error: { message: "Item is required" }, data: null };
      }
      if (
        typeof value !== "string" ||
        !changeOrderDisposition.includes(
          value as (typeof changeOrderDisposition)[number]
        )
      ) {
        return { error: { message: "Invalid disposition" }, data: null };
      }

      const update = await client
        .from("changeOrderItem")
        .update({
          disposition: value as (typeof changeOrderDisposition)[number],
          updatedBy: userId
        })
        .eq("id", id);

      if (update.error) {
        console.error(update.error);
        return {
          error: { message: "Failed to update disposition" },
          data: null
        };
      }

      return { data: update.data, error: null };
    }
    default:
      return { error: { message: "Invalid intent" }, data: null };
  }
}
