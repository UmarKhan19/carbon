import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  methodMaterialValidator,
  replaceMethodMaterialSteps,
  upsertMethodMaterial
} from "~/modules/items";
import { getFormDataArray, setCustomFields } from "~/utils/form";

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
  const validation = await validator(methodMaterialValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMethodMaterial = await upsertMethodMaterial(client, {
    ...validation.data,
    id: id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });
  if (updateMethodMaterial.error) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateMethodMaterial.error, "Failed to update method material")
      )
    );
  }

  const methodMaterialId = updateMethodMaterial.data?.id;
  if (!methodMaterialId) {
    return data(
      {
        id: null
      },
      await flash(
        request,
        error(updateMethodMaterial, "Failed to update method material")
      )
    );
  }

  // Per-step assignment (part ↔ step is many-to-many). Read from formData directly and
  // replace methodMaterialStep rows.
  const methodOperationStepIds = getFormDataArray(
    formData,
    "methodOperationStepIds"
  );
  const stepLink = await replaceMethodMaterialSteps(
    client,
    methodMaterialId,
    methodOperationStepIds
  );
  if (stepLink.error) {
    return data(
      { id: methodMaterialId },
      await flash(request, error(stepLink.error, "Failed to link part to steps"))
    );
  }

  return {
    id: methodMaterialId,
    success: true,
    message: "Material updated"
  };
}
