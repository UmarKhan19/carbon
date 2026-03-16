import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import type { Chart } from "~/modules/accounting";
import {
  getCompaniesInGroup,
  getFinancialStatementBalances,
  translateCompanyBalances
} from "~/modules/accounting";
import {
  ReportFilters,
  TrialBalanceTree
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
  const showTranslated = searchParams.get("showTranslated") === "true";

  const [balances, companies] = await Promise.all([
    getFinancialStatementBalances(client, companyGroupId, selectedCompanyId, {
      startDate,
      endDate
    }),
    getCompaniesInGroup(client, companyGroupId)
  ]);

  if (balances.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(balances.error, "Failed to load trial balance")
      )
    );
  }

  const companiesList = companies.data ?? [];
  const parentCompany = companiesList.find((c) => !c.parentCompanyId);
  const selectedCompany = companiesList.find((c) => c.id === selectedCompanyId);
  const parentCurrency = parentCompany?.baseCurrencyCode ?? null;
  const isForeignCurrency =
    !!parentCurrency &&
    !!selectedCompany?.baseCurrencyCode &&
    selectedCompany.baseCurrencyCode !== parentCurrency;

  // Trial balance shows all accounts (both balance sheet and income statement)
  let accounts = (balances.data ?? []) as (Chart & {
    translatedBalance?: number;
    exchangeRate?: number;
  })[];

  if (showTranslated && isForeignCurrency && parentCurrency) {
    const periodEnd = endDate ?? new Date().toISOString().split("T")[0];
    const translation = await translateCompanyBalances(
      client,
      companyGroupId,
      selectedCompanyId!,
      parentCurrency,
      periodEnd,
      startDate ?? undefined
    );

    if (translation.data) {
      const translationMap = new Map(
        translation.data.map((t) => [t.accountId, t])
      );

      accounts = accounts.map((account) => {
        const t = translationMap.get(account.id);
        if (t) {
          return {
            ...account,
            translatedBalance: Number(t.translatedBalance),
            exchangeRate: Number(t.exchangeRate)
          };
        }
        return account;
      });
    }
  }

  return {
    trialBalance: accounts,
    companies: companiesList,
    selectedCompanyId,
    showTranslated: showTranslated && isForeignCurrency,
    isForeignCurrency,
    parentCurrency
  };
}

export default function TrialBalanceRoute() {
  const {
    trialBalance,
    companies,
    selectedCompanyId,
    showTranslated,
    isForeignCurrency,
    parentCurrency
  } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ReportFilters
        companies={companies}
        selectedCompanyId={selectedCompanyId}
        isForeignCurrency={isForeignCurrency}
        parentCurrency={parentCurrency}
      />
      <TrialBalanceTree
        data={trialBalance}
        showTranslated={showTranslated}
        parentCurrency={parentCurrency}
      />
    </VStack>
  );
}
