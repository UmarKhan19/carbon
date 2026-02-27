import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import {
  currencyValidator,
  getCurrency,
  upsertCurrency
} from "~/modules/accounting";
import { CurrencyForm } from "~/modules/accounting/ui/Currencies";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { currenciesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { currencyId } = params;
  if (!currencyId) throw notFound("currencyId not found");

  const currency = await getCurrency(client, currencyId);

  return {
    currency: currency?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(currencyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateCurrency = await upsertCurrency(client, {
    id,
    ...d,
    companyGroupId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });

  if (updateCurrency.error) {
    return data(
      {},
      await flash(
        request,
        error(updateCurrency.error, "Failed to update currency")
      )
    );
  }

  throw redirect(
    `${path.to.currencies}?${getParams(request)}`,
    await flash(request, success("Updated currency"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(currenciesQuery().queryKey, null);
  return await serverAction();
}

export default function EditCurrencysRoute() {
  const { currency } = useLoaderData<typeof loader>();

  const initialValues = {
    id: currency?.id ?? undefined,
    name: currency?.name ?? "",
    code: currency?.code ?? "",
    exchangeRate: currency?.exchangeRate ?? 1,
    decimalPlaces: currency?.decimalPlaces ?? 2,
    ...getCustomFields(currency?.customFields)
  };

  return <CurrencyForm key={initialValues.id} initialValues={initialValues} />;
}
