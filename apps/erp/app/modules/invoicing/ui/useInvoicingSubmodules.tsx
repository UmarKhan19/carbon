import { useLingui } from "@lingui/react/macro";
import { BsCartDash } from "react-icons/bs";
import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const useInvoicingRoutes = (t: any): AuthenticatedRouteGroup[] => [
  {
    name: t`Manage`,
    routes: [
      {
        name: t`Purchasing`,
        to: path.to.purchaseInvoices,
        role: "employee",
        icon: <BsCartDash />
      }
      // {
      //   name: "Sales",
      //   to: path.to.salesInvoices,
      //   role: "employee",
      //   icon: <BsCartPlus />,
      // },
    ]
  }
];

export default function useInvoicingSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  return {
    groups: useInvoicingRoutes(t)
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
