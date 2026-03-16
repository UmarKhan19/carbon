import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import type { Chart } from "~/modules/accounting";
import {
  getCompaniesInGroup,
  getFinancialStatementBalances
} from "~/modules/accounting";
import {
  FinancialStatementTree,
  ReportFilters
} from "~/modules/accounting/ui/Reports";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Balance Sheet",
  to: path.to.balanceSheet
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee"
    }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const selectedCompanyId = searchParams.get("companyId") || companyId;
  const endDate = searchParams.get("endDate") || null;

  const [balances, companies] = await Promise.all([
    getFinancialStatementBalances(client, companyGroupId, selectedCompanyId, {
      startDate: null,
      endDate
    }),
    getCompaniesInGroup(client, companyGroupId)
  ]);

  if (balances.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(balances.error, "Failed to load balance sheet")
      )
    );
  }

  const balanceSheetAccounts = (balances.data ?? []).filter(
    (a) => a.incomeBalance === "Balance Sheet"
  ) as Chart[];

  return {
    balanceSheet: balanceSheetAccounts,
    companies: companies.data ?? [],
    selectedCompanyId
  };
}

export default function BalanceSheetRoute() {
  const { balanceSheet, companies, selectedCompanyId } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyId={selectedCompanyId}
      />
      <FinancialStatementTree data={balanceSheet} />
    </VStack>
  );
}
