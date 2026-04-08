import { useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();

  const modules: Authenticated<NavItem>[] = [
    {
      name: t({ id: "Shop Floor", message: "Shop Floor" }),
      to: path.to.external.mes,
      icon: LuTvMinimalPlay,
      role: "employee"
    },
    {
      permission: "sales",
      name: t({ id: "Sales", message: "Sales" }),
      to: path.to.sales,
      icon: LuCrown
    },
    {
      permission: "production",
      name: t({ id: "Production", message: "Production" }),
      to: path.to.production,
      icon: LuFactory
    },
    {
      permission: "parts",
      name: t({ id: "Items", message: "Items" }),
      to: path.to.parts,
      icon: LuSquareStack
    },
    {
      permission: "inventory",
      name: t({ id: "Inventory", message: "Inventory" }),
      to: path.to.inventory,
      icon: LuBox
    },
    {
      permission: "purchasing",
      name: t({ id: "Purchasing", message: "Purchasing" }),
      to: path.to.purchasing,
      icon: LuShoppingCart
    },
    {
      permission: "quality",
      name: t({ id: "Quality", message: "Quality" }),
      to: path.to.quality,
      icon: LuFolderCheck
    },
    {
      permission: "accounting",
      name: t({ id: "Finance", message: "Finance" }),
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
      name: t({ id: "People", message: "People" }),
      to: path.to.people,
      icon: LuUsers
    },
    {
      permission: "resources",
      name: t({ id: "Resources", message: "Resources" }),
      to: path.to.resources,
      icon: LuWrench
    },
    {
      permission: "documents",
      name: t({ id: "Documents", message: "Documents" }),
      to: path.to.documents,
      icon: LuFiles
    },
    {
      permission: "users",
      name: t({ id: "Users", message: "Users" }),
      to: path.to.employeeAccounts,
      icon: LuShield
    },
    {
      permission: "settings",
      name: t({ id: "Settings", message: "Settings" }),
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
