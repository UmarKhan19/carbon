import {
  LuArrowRightLeft,
  LuCalendarClock,
  LuHandCoins,
  LuListChecks,
  LuNetwork,
  LuQrCode,
  LuTally5,
  LuThermometer,
  LuTruck,
  LuWarehouse
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const inventoryRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Receipts",
        to: path.to.receipts,
        icon: <LuHandCoins />,
        table: "receipt"
      },
      {
        name: "Shipments",
        to: path.to.shipments,
        icon: <LuTruck />,
        table: "shipment"
      },
      {
        name: "Stock Transfers",
        to: path.to.stockTransfers,
        icon: <LuListChecks />,
        table: "stockTransfer"
      },
      {
        name: "Warehouse Transfers",
        to: path.to.warehouseTransfers,
        icon: <LuArrowRightLeft />,
        table: "warehouseTransfer"
      }
    ]
  },
  {
    name: "Track",
    routes: [
      {
        name: "Kanbans",
        to: path.to.kanbans,
        role: "employee",
        icon: <LuQrCode />
      },
      {
        name: "Quantities",
        to: path.to.inventory,
        role: "employee",
        icon: <LuTally5 />,
        table: "inventory"
      },
      {
        name: "Tracked Entities",
        to: path.to.trackedEntities,
        role: "employee",
        icon: <LuQrCode />
      },
      {
        name: "Near-Expiry",
        to: path.to.nearExpiryInventory,
        role: "employee",
        icon: <LuCalendarClock />
      },
      {
        name: "Traceability",
        to: path.to.traceability,
        role: "employee",
        icon: <LuNetwork />
      }
    ]
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Shelves",
        to: path.to.shelves,
        role: "employee",
        icon: <LuWarehouse />,
        table: "shelf"
      },
      {
        name: "Shipping Methods",
        to: path.to.shippingMethods,
        role: "employee",
        icon: <LuTruck />
      },
      {
        name: "Shelf Life Types",
        to: path.to.storageTypes,
        role: "employee",
        icon: <LuThermometer />
      }
    ]
  }
];

export default function useInventorySubmodules() {
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  return {
    groups: inventoryRoutes
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
            } else {
              return true;
            }
          })
          .map(addSavedViewsToRoutes)
      }))
  };
}
