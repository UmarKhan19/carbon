import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import {
  LuBan,
  LuCreditCard,
  LuGlobe,
  LuShapes,
  LuSquareUser,
  LuStar
} from "react-icons/lu";
import {
  RiProgress2Line,
  RiProgress4Line,
  RiProgress8Line
} from "react-icons/ri";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useSalesSubmodules() {
  const { _: t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();
  const salesRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t(msg({ id: "Manage", message: "Manage" })),
      routes: [
        {
          name: t(msg({ id: "Customers", message: "Customers" })),
          to: path.to.customers,
          icon: <LuSquareUser />,
          table: "customer"
        },
        {
          name: t(msg({ id: "RFQs", message: "RFQs" })),
          to: path.to.salesRfqs,
          icon: <RiProgress2Line />,
          table: "salesRfq"
        },
        {
          name: t(msg({ id: "Quotes", message: "Quotes" })),
          to: path.to.quotes,
          icon: <RiProgress4Line />,
          table: "quote"
        },
        {
          name: t(msg({ id: "Orders", message: "Orders" })),
          to: path.to.salesOrders,
          icon: <RiProgress8Line />,
          table: "salesOrder"
        },
        {
          name: t(msg({ id: "Invoices", message: "Invoices" })),
          to: path.to.salesInvoices,
          icon: <LuCreditCard />,
          permission: "invoicing",
          table: "salesInvoice"
        },
        {
          name: t(msg({ id: "Portals", message: "Portals" })),
          to: path.to.customerPortals,
          role: "employee",
          icon: <LuGlobe />
        }
      ]
    },
    {
      name: t(msg({ id: "Configure", message: "Configure" })),
      routes: [
        {
          name: t(msg({ id: "No Quotes", message: "No Quotes" })),
          to: path.to.noQuoteReasons,
          role: "employee",
          icon: <LuBan />
        },

        {
          name: t(msg({ id: "Statuses", message: "Statuses" })),
          to: path.to.customerStatuses,
          role: "employee",
          icon: <LuStar />
        },
        {
          name: t(msg({ id: "Types", message: "Types" })),
          to: path.to.customerTypes,
          role: "employee",
          icon: <LuShapes />
        }
      ]
    }
  ];

  return {
    groups: salesRoutes
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
