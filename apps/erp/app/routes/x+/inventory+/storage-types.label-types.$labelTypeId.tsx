import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getShelfLifeLabelType,
  shelfLifeLabelTypeValidator,
  upsertShelfLifeLabelType
} from "~/modules/items";
import { ShelfLifeLabelTypeForm } from "~/modules/items/ui/Item";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const { labelTypeId } = params;
  if (!labelTypeId) throw notFound("labelTypeId not found");

  const labelType = await getShelfLifeLabelType(client, labelTypeId, companyId);

  return { labelType: labelType?.data ?? null };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(shelfLifeLabelTypeValidator).validate(
    formData
  );

  if (validation.error) return validationError(validation.error);

  const { id, ...d } = validation.data;
  if (!id) throw notFound("id not found");

  const result = await upsertShelfLifeLabelType(client, {
    id,
    ...d,
    updatedBy: userId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to update label type"))
    );
  }

  throw redirect(
    `${path.to.storageTypes}?${getParams(request)}`,
    await flash(request, success("Updated label type"))
  );
}

export default function EditShelfLifeLabelTypeRoute() {
  const { labelType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: labelType?.id ?? undefined,
    name: labelType?.name ?? "",
    active: labelType?.active ?? true
  };

  return (
    <ShelfLifeLabelTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
