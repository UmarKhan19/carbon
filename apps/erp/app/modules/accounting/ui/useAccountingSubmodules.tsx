import {
  LuArrowLeftRight,
  LuAxis3D,
  LuBetweenHorizontalStart,
  LuCalendar1,
  LuCircleDollarSign,
  LuEuro,
  LuFileSpreadsheet,
  LuHandCoins,
  LuScale,
  LuSheet,
  LuTrendingUp
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const accountingRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Reports",
    routes: [
      {
        name: "Trial Balance",
        to: path.to.trialBalance,
        role: "employee",
        icon: <LuFileSpreadsheet />
      },
      {
        name: "Balance Sheet",
        to: path.to.balanceSheet,
        role: "employee",
        icon: <LuScale />
      },
      {
        name: "Income Statement",
        to: path.to.incomeStatement,
        role: "employee",
        icon: <LuTrendingUp />
      }
    ]
  },
  {
    name: "Manage",
    routes: [
      {
        name: "Chart of Accounts",
        to: path.to.chartOfAccounts,
        role: "employee",
        icon: <LuSheet />
      },
      {
        name: "Intercompany",
        to: path.to.intercompany,
        role: "employee",
        icon: <LuArrowLeftRight />
      }
      // {
      //   name: "Journals",
      //   to: path.to.accountingJournals,
      //   role: "employee",
      // },
    ]
  },

  {
    name: "Configure",
    routes: [
      {
        name: "Cost Centers",
        to: path.to.costCenters,
        role: "employee",
        icon: <LuCircleDollarSign />
      },
      {
        name: "Default Accounts",
        to: path.to.accountingDefaults,
        icon: <LuBetweenHorizontalStart />,
        role: "employee"
      },
      {
        name: "Dimensions",
        to: path.to.dimensions,
        role: "employee",
        icon: <LuAxis3D />
      },
      {
        name: "Exchange Rates",
        to: path.to.exchangeRates,
        role: "employee",
        icon: <LuEuro />
      },
      {
        name: "Fiscal Year",
        to: path.to.fiscalYears,
        role: "employee",
        icon: <LuCalendar1 />
      },
      {
        name: "Payment Terms",
        to: path.to.paymentTerms,
        role: "employee",
        icon: <LuHandCoins />
      }
    ]
  }
];

export default function useAccountingSubmodules() {
  const permissions = usePermissions();
  return {
    groups: accountingRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else {
            return true;
          }
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else {
            return true;
          }
        })
      }))
  };
}
