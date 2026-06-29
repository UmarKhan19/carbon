import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useNavigate } from "react-router";
import {
  changeOrderTypeValidator,
  upsertChangeOrderType
} from "~/modules/items";
import { ChangeOrderTypeForm } from "~/modules/items/ui/ChangeOrderType";
import { getParams, path } from "~/utils/path";
import { changeOrderTypesQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "production"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(changeOrderTypeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const insertChangeOrderType = await upsertChangeOrderType(client, {
    ...rest,
    companyId,
    createdBy: userId
  });
  if (insertChangeOrderType.error) {
    return data(
      {},
      await flash(
        request,
        error(insertChangeOrderType.error, "Failed to insert change order type")
      )
    );
  }

  const changeOrderTypeId = insertChangeOrderType.data?.[0]?.id;
  if (!changeOrderTypeId) {
    return data(
      {},
      await flash(
        request,
        error(insertChangeOrderType, "Failed to insert change order type")
      )
    );
  }

  return modal
    ? data(insertChangeOrderType, { status: 201 })
    : redirect(
        `${path.to.changeOrderTypes}?${getParams(request)}`,
        await flash(request, success("Change order type created"))
      );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    changeOrderTypesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewChangeOrderTypeRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: ""
  };

  return (
    <ChangeOrderTypeForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
