import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { useRouteData } from "~/hooks";
import type { AccountListItem } from "~/modules/accounting";
import { getPurchasingPostingGroups } from "~/modules/accounting";
import { PurchasingPostingGroupsTable } from "~/modules/accounting/ui/PostingGroups";
import { getItemPostingGroupsList } from "~/modules/items";
import { getSupplierTypesList } from "~/modules/purchasing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Purchasing Groups`,
  to: path.to.accountingGroupsPurchasing
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: ["accounting", "purchasing"]
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [purchasingGroups, itemPostingGroups, supplierTypes] =
    await Promise.all([
      getPurchasingPostingGroups(client, companyId, {
        limit,
        offset,
        sorts,
        filters
      }),
      getItemPostingGroupsList(client, companyId),
      getSupplierTypesList(client, companyId)
    ]);
  if (purchasingGroups.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(
          purchasingGroups.error,
          "Failed to fetch purchasing posting groups"
        )
      )
    );
  }

  return {
    data: purchasingGroups.data ?? [],
    itemPostingGroups: itemPostingGroups.data ?? [],
    supplierTypes: supplierTypes.data ?? [],
    count: purchasingGroups.count ?? 0
  };
}

export default function PurchasingPostingGroupsRoute() {
  const { data, itemPostingGroups, supplierTypes, count } =
    useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    balanceSheetAccounts: AccountListItem[];
    incomeStatementAccounts: AccountListItem[];
  }>(path.to.accounting);

  return (
    <VStack spacing={0} className="h-full">
      <PurchasingPostingGroupsTable
        data={data}
        count={count}
        itemPostingGroups={itemPostingGroups}
        supplierTypes={supplierTypes}
        balanceSheetAccounts={routeData?.balanceSheetAccounts ?? []}
        incomeStatementAccounts={routeData?.incomeStatementAccounts ?? []}
      />
      <Outlet />
    </VStack>
  );
}
