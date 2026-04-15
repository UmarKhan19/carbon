import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  resolvePriceList,
  upsertCustomerItemPriceOverride,
} from "~/modules/sales/pricing";
import { PriceListView } from "~/modules/sales/pricing/ui";
import type { Handle } from "~/utils/handle";
import { getParams, path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Price List",
  to: path.to.salesPriceList,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const customerId = searchParams.get("customerId");
  const customerTypeId = searchParams.get("customerTypeId");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const result = await resolvePriceList(client, companyId, {
    customerId: customerId ?? undefined,
    customerTypeId: customerTypeId ?? undefined,
    search: search ?? undefined,
    limit,
    offset,
    sorts,
    filters,
  });

  return {
    data: result.data,
    count: result.count,
    customerId,
    customerTypeId,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const formData = await request.formData();
  const customerId = formData.get("customerId") as string | null;
  const customerTypeId = formData.get("customerTypeId") as string | null;
  const itemId = formData.get("itemId") as string;
  const overridePrice = Number(formData.get("overridePrice"));

  if ((!customerId && !customerTypeId) || !itemId || !Number.isFinite(overridePrice)) {
    throw redirect(
      `${path.to.salesPriceList}?${getParams(request)}`,
      await flash(request, error(null, "Invalid override data"))
    );
  }

  const result = await upsertCustomerItemPriceOverride(
    client,
    companyId,
    userId,
    {
      customerId: customerId || undefined,
      customerTypeId: customerTypeId || undefined,
      itemId,
      overridePrice,
    }
  );

  if (result.error) {
    throw redirect(
      `${path.to.salesPriceList}?${getParams(request)}`,
      await flash(request, error(result.error, "Failed to save price override"))
    );
  }

  throw redirect(
    `${path.to.salesPriceList}?${getParams(request)}`,
    await flash(request, success("Price override saved"))
  );
}

export default function PriceListRoute() {
  const { data, count, customerId, customerTypeId } =
    useLoaderData<typeof loader>();

  return (
    <PriceListView
      data={data}
      count={count}
      customerId={customerId}
      customerTypeId={customerTypeId}
    />
  );
}
