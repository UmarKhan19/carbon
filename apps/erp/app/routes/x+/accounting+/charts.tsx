import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getChartOfAccounts } from "~/modules/accounting";
import { ChartOfAccountsTable } from "~/modules/accounting/ui/ChartOfAccounts";
import ChartOfAccountsTableFilters from "~/modules/accounting/ui/ChartOfAccounts/ChartOfAccountsTableFilters";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Chart of Accounts`,
  to: path.to.chartOfAccounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const name = searchParams.get("name");
  const incomeBalance = searchParams.get("incomeBalance");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const chartOfAccounts = await getChartOfAccounts(client, companyId, {
    name,
    // @ts-expect-error TS2322 - TODO: fix type
    incomeBalance,
    startDate,
    endDate
  });

  if (chartOfAccounts.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(chartOfAccounts.error, "Failed to get chart of accounts")
      )
    );
  }

  return {
    chartOfAccounts: chartOfAccounts.data ?? []
  };
}

export default function ChartOfAccountsRoute() {
  const { chartOfAccounts } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ChartOfAccountsTableFilters />
      <ChartOfAccountsTable data={chartOfAccounts} />
      <Outlet />
    </VStack>
  );
}
