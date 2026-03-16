import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getCompaniesInGroup, getTrialBalance } from "~/modules/accounting";
import {
  ReportFilters,
  TrialBalanceTable
} from "~/modules/accounting/ui/Reports";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Trial Balance",
  to: path.to.trialBalance
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
  const startDate = searchParams.get("startDate") || null;
  const endDate = searchParams.get("endDate") || null;

  const [trialBalance, companies] = await Promise.all([
    getTrialBalance(client, companyGroupId, selectedCompanyId, {
      startDate,
      endDate
    }),
    getCompaniesInGroup(client, companyGroupId)
  ]);

  if (trialBalance.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(trialBalance.error, "Failed to load trial balance")
      )
    );
  }

  const data = trialBalance.data ?? [];

  return {
    trialBalance: data,
    count: data.length,
    companies: companies.data ?? [],
    selectedCompanyId
  };
}

export default function TrialBalanceRoute() {
  const { trialBalance, count, companies, selectedCompanyId } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyId={selectedCompanyId}
      />
      <TrialBalanceTable data={trialBalance} count={count} />
    </VStack>
  );
}
