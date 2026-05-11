import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuArrowLeftRight,
  LuAxis3D,
  LuBetweenHorizontalStart,
  LuBookOpen,
  LuCalendar1,
  LuCoins,
  LuEuro,
  LuFileSpreadsheet,
  LuHandCoins,
  LuScale,
  LuSheet,
  LuTrendingUp
} from "react-icons/lu";
import { usePermissions, useRouteData, useSettings } from "~/hooks";
import type { AuthenticatedRouteGroup, Role } from "~/types";
import { path } from "~/utils/path";

const multiCompanyRoutes = new Set<string>([path.to.intercompany]);
const accountingOnlyRoutes = new Set<string>([
  path.to.balanceSheet,
  path.to.incomeStatement,
  path.to.trialBalance,
  path.to.intercompany,
  path.to.accountingJournals
]);

export default function useAccountingSubmodules() {
  const { t } = useLingui();
  const accountingRoutes: AuthenticatedRouteGroup[] = useMemo(
    () => [
      {
        name: t`Reports`,
        routes: [
          {
            icon: <LuScale />,
            name: t`Balance Sheet`,
            role: "employee",
            to: path.to.balanceSheet
          },
          {
            icon: <LuTrendingUp />,
            name: t`Income Statement`,
            role: "employee",
            to: path.to.incomeStatement
          },
          {
            icon: <LuFileSpreadsheet />,
            name: t`Trial Balance`,
            role: "employee",
            to: path.to.trialBalance
          }
        ]
      },
      {
        name: t`Manage`,
        routes: [
          {
            icon: <LuArrowLeftRight />,
            name: t`Intercompany`,
            role: "employee",
            to: path.to.intercompany
          },
          {
            icon: <LuBookOpen />,
            name: t`Journal Entries`,
            role: "employee",
            to: path.to.accountingJournals
          }
        ]
      },

      {
        name: t`Configure`,
        routes: [
          {
            icon: <LuSheet />,
            name: t`Chart of Accounts`,
            role: "employee",
            to: path.to.chartOfAccounts
          },
          {
            icon: <LuCoins />,
            name: t`Cost Centers`,
            role: "employee",
            to: path.to.costCenters
          },
          {
            icon: <LuBetweenHorizontalStart />,
            name: t`Default Accounts`,
            role: "employee",
            to: path.to.accountingDefaults
          },
          {
            icon: <LuAxis3D />,
            name: t`Dimensions`,
            role: "employee",
            to: path.to.dimensions
          },
          {
            icon: <LuEuro />,
            name: t`Exchange Rates`,
            role: "employee",
            to: path.to.exchangeRates
          },
          {
            icon: <LuCalendar1 />,
            name: t`Fiscal Year`,
            role: "employee",
            to: path.to.fiscalYears
          },
          {
            icon: <LuHandCoins />,
            name: t`Payment Terms`,
            role: "employee",
            to: path.to.paymentTerms
          }
        ]
      }
    ],
    [t]
  );

  const settings = useSettings();
  const accountingEnabled = (settings as any).accountingEnabled ?? false;
  const permissions = usePermissions();
  const routeData = useRouteData<{ hasMultipleCompanies: boolean }>(
    path.to.accounting
  );
  const hasMultipleCompanies = routeData?.hasMultipleCompanies ?? false;

  const isRouteVisible = (route: { to: string; role?: string }) => {
    if (route.role && !permissions.is(route.role as Role)) return false;
    if (!hasMultipleCompanies && multiCompanyRoutes.has(route.to)) return false;
    if (!accountingEnabled && accountingOnlyRoutes.has(route.to)) return false;
    return true;
  };

  return {
    groups: accountingRoutes
      .filter((group) => group.routes.some(isRouteVisible))
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isRouteVisible)
      }))
  };
}
