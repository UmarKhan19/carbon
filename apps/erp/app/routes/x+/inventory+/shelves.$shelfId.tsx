import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getShelf,
  ShelfForm,
  shelfValidator,
  upsertShelf
} from "~/modules/inventory";
import { getStorageTypes } from "~/modules/items";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, shelvesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const { shelfId } = params;
  if (!shelfId) throw notFound("shelfId not found");

  const [shelf, storageTypes] = await Promise.all([
    getShelf(client, shelfId),
    getStorageTypes(client, companyId)
  ]);

  return {
    shelf: shelf?.data ?? null,
    storageTypes: storageTypes.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(shelfValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateShelf = await upsertShelf(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateShelf.error) {
    return data(
      {},
      await flash(request, error(updateShelf.error, "Failed to update shelf"))
    );
  }

  throw redirect(
    `${path.to.shelves}?${getParams(request)}`,
    await flash(request, success("Updated shelf"))
  );
}

export async function clientAction({
  request,
  serverAction
}: ClientActionFunctionArgs) {
  const companyId = getCompanyId();

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

export default function EditShelfRoute() {
  const { shelf, storageTypes } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const storageTypeOptions = storageTypes.map((st) => ({
    label: st.name,
    value: st.id
  }));

  const initialValues = {
    id: shelf?.id ?? undefined,
    name: shelf?.name ?? "",
    locationId: shelf?.locationId ?? "",
    // @ts-ignore - storageTypeId added via migration, not yet in generated types
    storageTypeId: shelf?.storageTypeId ?? undefined,
    ...getCustomFields(shelf?.customFields)
  };

  return (
    <ShelfForm
      key={initialValues.id}
      initialValues={initialValues}
      locationId={initialValues.locationId}
      storageTypes={storageTypeOptions}
      onClose={() => navigate(-1)}
    />
  );
}
