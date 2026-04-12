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
import { usePermissions, useRouteData } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const multiCompanyRoutes = new Set([path.to.intercompany]);

export default function useAccountingSubmodules() {
  const { t } = useLingui();
  const accountingRoutes: AuthenticatedRouteGroup[] = useMemo(
    () => [
      {
        name: t`Reports`,
        routes: [
          {
            name: t`Balance Sheet`,
            to: path.to.balanceSheet,
            role: "employee",
            icon: <LuScale />
          },
          {
            name: t`Income Statement`,
            to: path.to.incomeStatement,
            role: "employee",
            icon: <LuTrendingUp />
          },
          {
            name: t`Trial Balance`,
            to: path.to.trialBalance,
            role: "employee",
            icon: <LuFileSpreadsheet />
          }
        ]
      },
      {
        name: t`Manage`,
        routes: [
          {
            name: t`Intercompany`,
            to: path.to.intercompany,
            role: "employee",
            icon: <LuArrowLeftRight />
          },
          {
            name: t`Journal Entries`,
            to: path.to.accountingJournals,
            role: "employee",
            icon: <LuBookOpen />
          }
        ]
      },

      {
        name: t`Configure`,
        routes: [
          {
            name: t`Chart of Accounts`,
            to: path.to.chartOfAccounts,
            role: "employee",
            icon: <LuSheet />
          },
          {
            name: t`Cost Centers`,
            to: path.to.costCenters,
            role: "employee",
            icon: <LuCoins />
          },
          {
            name: t`Default Accounts`,
            to: path.to.accountingDefaults,
            icon: <LuBetweenHorizontalStart />,
            role: "employee"
          },
          {
            name: t`Dimensions`,
            to: path.to.dimensions,
            role: "employee",
            icon: <LuAxis3D />
          },
          {
            name: t`Exchange Rates`,
            to: path.to.exchangeRates,
            role: "employee",
            icon: <LuEuro />
          },
          {
            name: t`Fiscal Year`,
            to: path.to.fiscalYears,
            role: "employee",
            icon: <LuCalendar1 />
          },
          {
            name: t`Payment Terms`,
            to: path.to.paymentTerms,
            role: "employee",
            icon: <LuHandCoins />
          }
        ]
      }
    ],
    [t]
  );

  const permissions = usePermissions();
  const routeData = useRouteData<{ hasMultipleCompanies: boolean }>(
    path.to.accounting
  );
  const hasMultipleCompanies = routeData?.hasMultipleCompanies ?? false;
  return {
    groups: accountingRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role && !permissions.is(route.role)) return false;
          if (!hasMultipleCompanies && multiCompanyRoutes.has(route.to))
            return false;
          return true;
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes.filter((route) => {
          if (route.role && !permissions.is(route.role)) return false;
          if (!hasMultipleCompanies && multiCompanyRoutes.has(route.to))
            return false;
          return true;
        })
      }))
  };
}
