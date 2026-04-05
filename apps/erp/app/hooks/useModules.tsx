import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import {
  LuBox,
  LuCrown,
  LuFactory,
  LuFiles,
  LuFolderCheck,
  LuLandmark,
  LuSettings,
  LuShield,
  LuShoppingCart,
  LuSquareStack,
  LuTvMinimalPlay,
  LuUsers,
  LuWrench
} from "react-icons/lu";
import type { Authenticated, NavItem } from "~/types";
import { path } from "~/utils/path";
import { usePermissions } from "./usePermissions";

export function useModules() {
  const permissions = usePermissions();
  const { _: t } = useLingui();

  const modules: Authenticated<NavItem>[] = [
    {
      name: t(msg({ id: "Shop Floor", message: "Shop Floor" })),
      to: path.to.external.mes,
      icon: LuTvMinimalPlay,
      role: "employee"
    },
    {
      permission: "sales",
      name: t(msg({ id: "Sales", message: "Sales" })),
      to: path.to.sales,
      icon: LuCrown
    },
    {
      permission: "production",
      name: t(msg({ id: "Production", message: "Production" })),
      to: path.to.production,
      icon: LuFactory
    },
    {
      permission: "parts",
      name: t(msg({ id: "Items", message: "Items" })),
      to: path.to.parts,
      icon: LuSquareStack
    },
    {
      permission: "inventory",
      name: t(msg({ id: "Inventory", message: "Inventory" })),
      to: path.to.inventory,
      icon: LuBox
    },
    {
      permission: "purchasing",
      name: t(msg({ id: "Purchasing", message: "Purchasing" })),
      to: path.to.purchasing,
      icon: LuShoppingCart
    },
    {
      permission: "quality",
      name: t(msg({ id: "Quality", message: "Quality" })),
      to: path.to.quality,
      icon: LuFolderCheck
    },
    {
      permission: "accounting",
      name: t(msg({ id: "Finance", message: "Finance" })),
      to: path.to.currencies,
      icon: LuLandmark
    },
    // {
    //   permission: "invoicing",
    //   name: "Invoicing",
    //   to: path.to.purchaseInvoices,
    //   icon: LuCreditCard,
    // },
    {
      permission: "people",
      name: t(msg({ id: "People", message: "People" })),
      to: path.to.people,
      icon: LuUsers
    },
    {
      permission: "resources",
      name: t(msg({ id: "Resources", message: "Resources" })),
      to: path.to.resources,
      icon: LuWrench
    },
    {
      permission: "documents",
      name: t(msg({ id: "Documents", message: "Documents" })),
      to: path.to.documents,
      icon: LuFiles
    },
    {
      permission: "users",
      name: t(msg({ id: "Users", message: "Users" })),
      to: path.to.employeeAccounts,
      icon: LuShield
    },
    {
      permission: "settings",
      name: t(msg({ id: "Settings", message: "Settings" })),
      to: path.to.company,
      icon: LuSettings
    }
  ];

  return modules.filter((item) => {
    if (item.permission) {
      return permissions.can("view", item.permission);
    } else if (item.role) {
      return permissions.is(item.role);
    } else {
      return true;
    }
  });
}
