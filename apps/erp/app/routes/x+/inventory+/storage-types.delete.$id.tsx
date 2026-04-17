import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteStorageType, getStorageType } from "~/modules/inventory";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { view: "parts" });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const storageType = await getStorageType(client, id);
  if (storageType.error) {
    throw redirect(
      path.to.storageTypes,
      await flash(
        request,
        error(storageType.error, "Failed to get storage type")
      )
    );
  }

  return { storageType: storageType.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, { delete: "parts" });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.storageTypes,
      await flash(request, error(params, "Failed to get a storage type id"))
    );
  }

  const { error: deleteTypeError } = await deleteStorageType(client, id);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.storageTypes}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete storage type")
      )
    );
  }

  throw redirect(
    path.to.storageTypes,
    await flash(request, success("Successfully deleted storage type"))
  );
}

export default function DeleteStorageTypeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { storageType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!storageType) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteStorageType(id)}
      name={storageType.name}
      text={t`Are you sure you want to delete the storage type: ${storageType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
