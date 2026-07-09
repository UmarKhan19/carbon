import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  methodOperationValidator,
  syncMethodOperationAbilities,
  upsertMethodOperation
} from "~/modules/items";
import { setCustomFields } from "~/utils/form";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const formData = await request.formData();
  const validation = await validator(methodOperationValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { abilities, ...operationData } = validation.data;

  const updateMethodOperation = await upsertMethodOperation(client, {
    ...operationData,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateMethodOperation.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateMethodOperation.error, "Failed to update method operation")
      )
    );
  }

  const methodOperationId = updateMethodOperation.data?.id;
  if (!methodOperationId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateMethodOperation, "Failed to update method operation")
      )
    );
  }

  const syncAbilities = await syncMethodOperationAbilities(
    client,
    methodOperationId,
    companyId,
    abilities ?? [],
    userId
  );
  if (syncAbilities.error) {
    return data(
      {
        id: methodOperationId
      },
      await flash(
        request,
        error(
          syncAbilities.error,
          "Failed to update method operation abilities"
        )
      )
    );
  }

  return {
    id: methodOperationId,
    success: true,
    message: "Operation updated"
  };
}
