import { useLingui } from "@lingui/react/macro";
import { LuDollarSign, LuList, LuTarget } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useAccountingSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();

  const accountingRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Currencies`,
          to: path.to.currencies,
          role: "employee",
          icon: <LuDollarSign />
        },
        {
          name: t`Default Accounts`,
          to: path.to.accountingDefaults,
          icon: <LuTarget />,
          role: "employee"
        },
        {
          name: t`Payment Terms`,
          to: path.to.paymentTerms,
          role: "employee",
          icon: <LuList />
        }
      ]
    }
  ];
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
