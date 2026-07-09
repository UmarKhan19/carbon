import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeOrderBomChangeValidator,
  findOtherOpenChangeOrdersForItem,
  upsertBomChange
} from "~/modules/items";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(changeOrderBomChangeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const d = validation.data;

  // V1 single-open-CO guard: an existing part can't be on two open COs. A
  // forward-reference (no itemId) mints a fresh part, so it can't collide — skip
  // the guard there. Editing an existing row (d.id) is exempt.
  if (d.itemId && !d.id) {
    const otherOpen = await findOtherOpenChangeOrdersForItem(client, {
      itemId: d.itemId,
      companyId,
      excludeChangeOrderId: d.changeOrderId
    });
    if (otherOpen.length > 0) {
      return data(
        { success: false },
        await flash(
          request,
          error(
            null,
            `This part is already on open change order ${otherOpen[0].changeOrderId}`
          )
        )
      );
    }
  }

  const upsert = await upsertBomChange(client, {
    id: d.id,
    changeOrderId: d.changeOrderId,
    changeType: d.changeType,
    itemId: d.itemId,
    newItemReadableId: d.changeType === "Add" ? d.newItemReadableId : undefined,
    newItemName: d.changeType === "Add" ? d.newItemName : undefined,
    companyId,
    userId
  });

  if (upsert.error || !upsert.data) {
    return data(
      { success: false },
      await flash(
        request,
        error(
          upsert.error,
          upsert.error?.message ?? "Failed to save BOM change"
        )
      )
    );
  }

  return { success: true, id: upsert.data.id };
}
