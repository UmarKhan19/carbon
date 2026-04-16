import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  type PriceSource,
  resolvePriceList,
  upsertCustomerItemPriceOverride
} from "~/modules/sales";
import PriceListView from "~/modules/sales/ui/Pricing/PriceListView";

import type { Handle } from "~/utils/handle";
import { getParams, path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Price List",
  to: path.to.salesPriceList
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  // Separate computed / context filters from DB filters
  const computedKeys = new Set(["source", "customerId", "customerTypeId"]);
  const sourceFilter = filters?.find((f) => f.column === "source");
  const customerIdFilter = filters?.find((f) => f.column === "customerId");
  const customerTypeIdFilter = filters?.find(
    (f) => f.column === "customerTypeId"
  );
  const dbFilters = filters?.filter((f) => !computedKeys.has(f.column));

  const customerId = customerIdFilter?.value ?? null;
  const customerTypeId = customerTypeIdFilter?.value ?? null;

  const result = await resolvePriceList(client, companyId, {
    customerId: customerId ?? undefined,
    customerTypeId: customerTypeId ?? undefined,
    search: search ?? undefined,
    limit,
    offset,
    sorts,
    filters: dbFilters
  });

  // Apply source filter post-resolution (computed field, not a DB column)
  let filteredData = result.data;
  if (sourceFilter?.value) {
    const allowedSources = sourceFilter.value.split(",") as PriceSource[];
    filteredData = result.data.filter((row) =>
      allowedSources.includes(row.source)
    );
  }

  return {
    data: filteredData,
    count: sourceFilter ? filteredData.length : result.count,
    customerId,
    customerTypeId
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const customerId = formData.get("customerId") as string | null;
  const itemId = formData.get("itemId") as string;
  const overridePrice = Number(formData.get("overridePrice"));
  const notes = (formData.get("notes") as string) || undefined;
  const validFrom = (formData.get("validFrom") as string) || undefined;
  const validTo = (formData.get("validTo") as string) || undefined;

  if (
    !customerId ||
    !itemId ||
    !Number.isFinite(overridePrice) ||
    overridePrice < 0
  ) {
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
      customerId,
      itemId,
      overridePrice,
      notes,
      validFrom,
      validTo
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
