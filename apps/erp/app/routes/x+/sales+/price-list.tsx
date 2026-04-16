import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getBaseCatalog, resolvePriceList } from "~/modules/sales";
import PriceListTable from "~/modules/sales/ui/Pricing/PriceOverridesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
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
  const customerId = searchParams.get("customerId");
  const customerTypeId = searchParams.get("customerTypeId");
  const onlyOverrides = searchParams.get("onlyOverrides") === "true";
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const groupOptionsQuery = client
    .from("group")
    .select("id, name, isCustomerOrgGroup, isCustomerTypeGroup")
    .eq("companyId", companyId)
    .or("isCustomerOrgGroup.eq.true,isCustomerTypeGroup.eq.true")
    .order("isCustomerTypeGroup", { ascending: false })
    .order("name");

  const listPromise =
    customerId || customerTypeId
      ? resolvePriceList(client, companyId, {
          customerId: customerId ?? undefined,
          customerTypeId: customerTypeId ?? undefined,
          onlyOverrides,
          search: search ?? undefined,
          limit,
          offset,
          sorts,
          filters
        })
      : getBaseCatalog(client, companyId, {
          search: search ?? undefined,
          limit,
          offset,
          sorts,
          filters
        });

  const [list, groupsResult] = await Promise.all([
    listPromise,
    groupOptionsQuery
  ]);

  const scopeOptions = (groupsResult.data ?? []).map((g) => ({
    value: g.id,
    label: g.name,
    helper: (g.isCustomerTypeGroup ? "Type" : "Customer") as "Type" | "Customer"
  }));

  return {
    data: list.data ?? [],
    count: list.count ?? 0,
    scopeOptions,
    hasScope: Boolean(customerId || customerTypeId)
  };
}

export default function PriceListRoute() {
  const { data, count, scopeOptions, hasScope } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PriceListTable
        data={data}
        count={count}
        scopeOptions={scopeOptions}
        hasScope={hasScope}
      />
      <Outlet />
    </VStack>
  );
}
