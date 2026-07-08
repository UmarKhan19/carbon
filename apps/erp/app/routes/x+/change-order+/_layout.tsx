import { msg } from "@lingui/core/macro";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

// Pathless layout: change-order detail pages live outside the items+ route tree,
// so they don't inherit the "Items" breadcrumb its _layout provides. This adds
// that crumb (Unique Shoes / Items / Change Orders / …) without altering the URL
// or the pages' own layout.
export const handle: Handle = {
  breadcrumb: msg`Items`,
  to: path.to.items,
  module: "items"
};

export default function ChangeOrderLayout() {
  return <Outlet />;
}
