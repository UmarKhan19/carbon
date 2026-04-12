import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteShelf, getShelf, shelfValidator } from "~/modules/inventory";
import { getParams, path } from "~/utils/path";
import { getCompanyId, shelvesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory"
  });
  const { shelfId } = params;
  if (!shelfId) throw notFound("shelfId not found");

  const shelf = await getShelf(client, shelfId);
  if (shelf.error) {
    throw redirect(
      path.to.shelves,
      await flash(request, error(shelf.error, "Failed to get shelf"))
    );
  }

  return { shelf: shelf.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "inventory"
  });

  const { shelfId } = params;
  if (!shelfId) {
    throw redirect(
      path.to.shelves,
      await flash(request, error(params, "Failed to get a shelf id"))
    );
  }

  const { error: deleteShelfError } = await deleteShelf(client, shelfId);
  if (deleteShelfError) {
    throw redirect(
      path.to.shelves,
      await flash(request, error(deleteShelfError, "Failed to delete shelf"))
    );
  }

  throw redirect(
    `${path.to.shelves}?${getParams(request)}`,
    await flash(request, success("Successfully deleted shelf"))
  );
}

export async function clientAction({
  request,
  serverAction
}: ClientActionFunctionArgs) {
  const companyId = getCompanyId();

  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return queryKey[0] === "shelves" && queryKey[1] === companyId;
    }
  });
  const formData = await request.clone().formData();
  const validation = await validator(shelfValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  if (companyId && validation.data.locationId) {
    window.clientCache?.setQueryData(
      shelvesQuery(companyId, validation.data.locationId).queryKey,
      null
    );
  }
  return await serverAction();
}

export default function DeleteShelfRoute() {
  const { shelfId } = useParams();
  if (!shelfId) throw notFound("shelfId not found");

  const { shelf } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!shelfId) return null;

  const onCancel = () => navigate(path.to.shelves);

  return (
    <ConfirmDelete
      action={path.to.deleteShelf(shelfId)}
      name={shelf.name}
      text={t`Are you sure you want to delete the shelf: ${shelf.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
