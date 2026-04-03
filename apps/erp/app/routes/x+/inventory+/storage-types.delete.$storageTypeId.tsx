import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteStorageType, getStorageType } from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { storageTypeId } = params;
  if (!storageTypeId) throw notFound("storageTypeId not found");

  const storageType = await getStorageType(client, storageTypeId, companyId);
  if (storageType.error) {
    throw redirect(
      `${path.to.storageTypes}?${getParams(request)}`,
      await flash(
        request,
        error(storageType.error, "Failed to get storage type")
      )
    );
  }

  return { storageType: storageType.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "inventory"
  });

  const { storageTypeId } = params;
  if (!storageTypeId) {
    throw redirect(
      path.to.storageTypes,
      await flash(request, error(params, "Failed to get storage type id"))
    );
  }

  const { error: deleteError } = await deleteStorageType(
    client,
    storageTypeId,
    companyId
  );
  if (deleteError) {
    throw redirect(
      path.to.storageTypes,
      await flash(request, error(deleteError, "Failed to delete storage type"))
    );
  }

  throw redirect(
    path.to.storageTypes,
    await flash(request, success("Deleted storage type"))
  );
}

export default function DeleteStorageTypeRoute() {
  const { storageTypeId } = useParams();
  const { storageType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!storageType) return null;
  if (!storageTypeId) throw notFound("storageTypeId not found");

  return (
    <ConfirmDelete
      action={path.to.deleteStorageType(storageTypeId)}
      name={storageType.name}
      text={`Are you sure you want to delete the storage type: ${storageType.name}? This cannot be undone.`}
      onCancel={() => navigate(path.to.storageTypes)}
    />
  );
}
