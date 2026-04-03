import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getStorageType,
  storageTypeValidator,
  upsertStorageType
} from "~/modules/items";
import { StorageTypeForm } from "~/modules/items/ui/Item";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const { storageTypeId } = params;
  if (!storageTypeId) throw notFound("storageTypeId not found");

  const storageType = await getStorageType(client, storageTypeId, companyId);

  return { storageType: storageType?.data ?? null };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(storageTypeValidator).validate(formData);

  if (validation.error) return validationError(validation.error);

  const { id, ...d } = validation.data;
  if (!id) throw notFound("id not found");

  const result = await upsertStorageType(client, {
    id,
    ...d,
    updatedBy: userId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to update storage type"))
    );
  }

  throw redirect(
    `${path.to.storageTypes}?${getParams(request)}`,
    await flash(request, success("Updated storage type"))
  );
}

export default function EditStorageTypeRoute() {
  const { storageType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: storageType?.id ?? undefined,
    name: storageType?.name ?? "",
    description: storageType?.description ?? "",
    active: storageType?.active ?? true
  };

  return (
    <StorageTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
