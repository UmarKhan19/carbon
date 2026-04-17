import { useLingui } from "@lingui/react/macro";
import { CgProfile } from "react-icons/cg";
import type { Route } from "~/types";
import { path } from "~/utils/path";

export default function useAccountSubmodules() {
  const { t } = useLingui();
  const accountRoutes: Route[] = [
    {
      name: t`Profile`,
      to: path.to.profile,
      icon: <CgProfile />
    }
  ];
  return { links: accountRoutes };
}
