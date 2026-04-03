import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { storageTypeValidator, upsertStorageType } from "~/modules/items";
import { StorageTypeForm } from "~/modules/items/ui/Item";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "parts" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(storageTypeValidator).validate(formData);

  if (validation.error) return validationError(validation.error);

  const result = await upsertStorageType(client, {
    ...validation.data,
    active: true,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to create storage type"))
    );
  }

  const modal = formData.get("type") === "modal";
  if (modal) return data(result, { status: 201 });

  throw redirect(
    `${path.to.storageTypes}?${getParams(request)}`,
    await flash(request, success("Created storage type"))
  );
}

export default function NewStorageTypeRoute() {
  const navigate = useNavigate();
  return (
    <StorageTypeForm
      initialValues={{ name: "" }}
      onClose={() => navigate(-1)}
    />
  );
}
