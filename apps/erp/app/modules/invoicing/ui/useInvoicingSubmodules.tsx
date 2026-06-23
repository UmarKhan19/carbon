import { useLingui } from "@lingui/react/macro";
import {
  LuArrowDownLeft,
  LuArrowUpRight,
  LuBanknote,
  LuCreditCard
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useInvoicingSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  const invoicingRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Accounts Payable`,
      routes: [
        {
          name: t`Payables`,
          to: path.to.payables,
          icon: <LuArrowUpRight />,
          permission: "invoicing"
        },
        {
          name: t`Purchasing Invoices`,
          to: path.to.invoicingPurchasing,
          icon: <LuCreditCard />,
          table: "purchaseInvoice",
          permission: "invoicing"
        }
      ]
    },
    {
      name: t`Accounts Receivable`,
      routes: [
        {
          name: t`Receivables`,
          to: path.to.receivables,
          icon: <LuArrowDownLeft />,
          permission: "invoicing"
        },
        {
          name: t`Sales Invoices`,
          to: path.to.salesInvoices,
          icon: <LuCreditCard />,
          table: "salesInvoice",
          permission: "invoicing"
        }
      ]
    },

    {
      name: t`Payments`,
      routes: [
        {
          name: t`Payments`,
          to: path.to.payments,
          icon: <LuBanknote />,
          table: "payment",
          permission: "invoicing"
        }
      ]
    }
  ];

  return {
    groups: invoicingRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else if (route.permission) {
            return permissions.can("view", route.permission);
          } else {
            return true;
          }
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes
          .filter((route) => {
            if (route.role) {
              return permissions.is(route.role);
            } else if (route.permission) {
              return permissions.can("view", route.permission);
            } else {
              return true;
            }
          })
          .map(addSavedViewsToRoutes)
      }))
  };
}
