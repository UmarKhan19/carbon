import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { methodMaterialValidator, upsertMethodMaterial } from "~/modules/items";
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

  // Part ↔ step links are managed from the STEP side (the BoP step editor's "Parts" picker),
  // so the material save no longer touches methodMaterialStep.

  return {
    id: methodMaterialId,
    success: true,
    message: "Material updated"
  };
}
