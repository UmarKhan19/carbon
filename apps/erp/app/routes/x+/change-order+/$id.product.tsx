import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeOrderProductAffectedValidator,
  findOtherOpenChangeOrdersForItem,
  upsertChangeOrderProductAffected
} from "~/modules/change-orders";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(
    changeOrderProductAffectedValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { changeOrderId, itemId } = validation.data;

  // V1 single-open-CO guard: reject if the part is already on another open CO.
  const otherOpen = await findOtherOpenChangeOrdersForItem(client, {
    itemId,
    companyId,
    excludeChangeOrderId: changeOrderId
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

  const upsert = await upsertChangeOrderProductAffected(client, {
    changeOrderId,
    itemId,
    companyId,
    createdBy: userId
  });

  if (upsert.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(upsert.error, "Failed to add product affected")
      )
    );
  }

  return { success: true };
}
