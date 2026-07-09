import { useLingui } from "@lingui/react/macro";
import { LuGitPullRequestArrow, LuTags } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useChangeOrdersSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  const changeOrderRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Change Orders`,
      routes: [
        {
          name: t`Change Orders`,
          to: path.to.changeOrders,
          icon: <LuGitPullRequestArrow />,
          table: "changeOrder"
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Change Order Types`,
          to: path.to.changeOrderTypes,
          icon: <LuTags />
        }
      ]
    }
  ];

  return {
    groups: changeOrderRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          }
          return true;
        });
        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes
          .filter((route) => {
            if (route.role) {
              return permissions.is(route.role);
            }
            return true;
          })
          .map(addSavedViewsToRoutes)
      }))
  };
}
