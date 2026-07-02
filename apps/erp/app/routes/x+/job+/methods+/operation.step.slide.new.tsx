import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertJobOperationStepSlide } from "~/modules/production";
import { operationStepSlideValidator } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const formData = await request.formData();
  const validation = await validator(operationStepSlideValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Same route handles create (upload) and edit (caption/size/annotations): an `id` means
  // update the existing slide, otherwise insert. On update we send ONLY the fields actually
  // submitted — upsert runs sanitize() (undefined → dropped), so a caption-only save never
  // wipes size/annotations. stepId (a jobOperationStep id) and imagePath are always present.
  const { id, stepId, imagePath, caption, sortOrder, size, annotations } =
    validation.data;
  const upsert = await upsertJobOperationStepSlide(
    client,
    id
      ? {
          id,
          stepId,
          imagePath,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
          ...(caption !== undefined ? { caption } : {}),
          ...(sortOrder !== undefined ? { sortOrder } : {}),
          ...(size !== undefined ? { size } : {}),
          ...(annotations !== undefined ? { annotations } : {})
        }
      : {
          stepId,
          imagePath,
          caption,
          sortOrder,
          size,
          annotations,
          companyId,
          createdBy: userId
        }
  );
  if (upsert.error) {
    return data(
      { id: null },
      await flash(
        request,
        error(upsert.error, "Failed to save job operation step slide")
      )
    );
  }

  return { id: upsert.data?.id ?? null };
}
