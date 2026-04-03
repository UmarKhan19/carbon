import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteShelfLifeLabelType,
  getShelfLifeLabelType
} from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { labelTypeId } = params;
  if (!labelTypeId) throw notFound("labelTypeId not found");

  const labelType = await getShelfLifeLabelType(client, labelTypeId, companyId);
  if (labelType.error) {
    throw redirect(
      `${path.to.storageTypes}?${getParams(request)}`,
      await flash(request, error(labelType.error, "Failed to get label type"))
    );
  }

  return { labelType: labelType.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "inventory"
  });

  const { labelTypeId } = params;
  if (!labelTypeId) {
    throw redirect(
      path.to.storageTypes,
      await flash(request, error(params, "Failed to get label type id"))
    );
  }

  const { error: deleteError } = await deleteShelfLifeLabelType(
    client,
    labelTypeId,
    companyId
  );
  if (deleteError) {
    throw redirect(
      path.to.storageTypes,
      await flash(request, error(deleteError, "Failed to delete label type"))
    );
  }

  throw redirect(
    path.to.storageTypes,
    await flash(request, success("Deleted label type"))
  );
}

export default function DeleteShelfLifeLabelTypeRoute() {
  const { labelTypeId } = useParams();
  const { labelType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!labelType) return null;
  if (!labelTypeId) throw notFound("labelTypeId not found");

  return (
    <ConfirmDelete
      action={path.to.deleteShelfLifeLabelType(labelTypeId)}
      name={labelType.name}
      text={`Are you sure you want to delete the label type: ${labelType.name}? This cannot be undone.`}
      onCancel={() => navigate(path.to.storageTypes)}
    />
  );
}
