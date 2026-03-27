import { LuFileBadge2, LuGroup, LuMonitor, LuUsers } from "react-icons/lu";
import { useSettings } from "~/hooks/useSettings";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const usersRoutes: RouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Accounts",
        to: path.to.employeeAccounts,
        icon: <LuUsers />
      },
      {
        name: "Operators",
        to: path.to.operators,
        icon: <LuMonitor />,
        setting: "consoleEnabled" as any
      },
      // {
      //   name: "Customers",
      //   to: path.to.customerAccounts,
      //   icon: <LuSquareUser />,
      // },
      // {
      //   name: "Suppliers",
      //   to: path.to.supplierAccounts,
      //   icon: <LuContainer />,
      // },
      {
        name: "Groups",
        to: path.to.groups,
        icon: <LuGroup />
      }
    ]
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Employee Types",
        to: path.to.employeeTypes,
        icon: <LuFileBadge2 />
      }
    ]
  }
];

export default function useUsersSubmodules() {
  const settings = useSettings();

  return {
    groups: usersRoutes.map((group) => ({
      ...group,
      routes: group.routes.filter(
        (route) =>
          !route.setting ||
          settings[route.setting as keyof typeof settings] === true
      )
    }))
  };
}
