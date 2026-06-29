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
  changeOrderTypeValidator,
  getChangeOrderType,
  upsertChangeOrderType
} from "~/modules/items";
import { ChangeOrderTypeForm } from "~/modules/items/ui/ChangeOrderType";
import { getParams, path } from "~/utils/path";
import { changeOrderTypesQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const changeOrderType = await getChangeOrderType(client, id);

  return {
    changeOrderType: changeOrderType?.data ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(changeOrderTypeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateChangeOrderType = await upsertChangeOrderType(client, {
    id,
    ...validation.data,
    updatedBy: userId
  });

  if (updateChangeOrderType.error) {
    return data(
      {},
      await flash(
        request,
        error(updateChangeOrderType.error, "Failed to update change order type")
      )
    );
  }

  throw redirect(
    `${path.to.changeOrderTypes}?${getParams(request)}`,
    await flash(request, success("Updated change order type"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const companyId = getCompanyId();

  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return (
        queryKey[0] === changeOrderTypesQuery(companyId).queryKey[0] &&
        queryKey[1] === companyId
      );
    }
  });

  return await serverAction();
}

export default function EditChangeOrderTypeRoute() {
  const { changeOrderType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: changeOrderType?.id ?? undefined,
    name: changeOrderType?.name ?? ""
  };

  return (
    <ChangeOrderTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
