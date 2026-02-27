import {
  LuAxis3D,
  LuBetweenHorizontalStart,
  LuEuro,
  LuHandCoins,
  LuSheet
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const accountingRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Chart of Accounts",
        to: path.to.chartOfAccounts,
        role: "employee",
        icon: <LuSheet />
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
        name: "Currencies",
        to: path.to.currencies,
        role: "employee",
        icon: <LuEuro />
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
      // {
      //   name: "Fiscal Year",
      //   to: path.to.fiscalYears,
      //   role: "employee",
      // },
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
