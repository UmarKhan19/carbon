import {
  LuCalendarClock,
  LuCalendarHeart,
  LuClock,
  LuListChecks,
  LuNetwork,
  LuUsers
} from "react-icons/lu";
import { useSavedViews } from "~/hooks/useSavedViews";
import { useSettings } from "~/hooks/useSettings";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const peopleRoutes: RouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Employees",
        to: path.to.people,
        icon: <LuUsers />,
        table: "employee"
      },
      {
        name: "Timecards",
        to: path.to.peopleTimecard,
        icon: <LuClock />,
        setting: "timeCardEnabled",
        table: "timeCardEntry"
      }
    ]
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Attributes",
        to: path.to.attributes,
        icon: <LuListChecks />
      },
      {
        name: "Departments",
        to: path.to.departments,
        icon: <LuNetwork />
      },
      {
        name: "Holidays",
        to: path.to.holidays,
        icon: <LuCalendarHeart />
      },
      {
        name: "Shifts",
        to: path.to.shifts,
        icon: <LuCalendarClock />
      }
    ]
  }
];

export default function usePeopleSubmodules() {
  const { addSavedViewsToRoutes } = useSavedViews();

  const settings = useSettings();

  return {
    groups: peopleRoutes.map((group) => ({
      ...group,
      routes: group.routes
        .filter(
          (route) =>
            !route.setting ||
            settings[route.setting as keyof typeof settings] === true
        )
        .map(addSavedViewsToRoutes)
    }))
  };
}
