import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteChangeOrderType, getChangeOrderType } from "~/modules/items";
import { getParams, path } from "~/utils/path";
import { changeOrderTypesQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const changeOrderType = await getChangeOrderType(client, id);
  if (changeOrderType.error) {
    throw redirect(
      path.to.changeOrderTypes,
      await flash(
        request,
        error(changeOrderType.error, "Failed to get change order type")
      )
    );
  }

  return { changeOrderType: changeOrderType.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.changeOrderTypes,
      await flash(
        request,
        error(params, "Failed to get a change order type id")
      )
    );
  }

  const { error: deleteTypeError } = await deleteChangeOrderType(client, id);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.changeOrderTypes}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete change order type")
      )
    );
  }

  throw redirect(
    path.to.changeOrderTypes,
    await flash(request, success("Successfully deleted change order type"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    changeOrderTypesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteChangeOrderTypeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { changeOrderType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!changeOrderType) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteChangeOrderType(id)}
      name={changeOrderType.name}
      text={t`Are you sure you want to delete the change order type: ${changeOrderType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
