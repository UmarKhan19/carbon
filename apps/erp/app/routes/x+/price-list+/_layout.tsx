import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Price List" }];
};

export const handle: Handle = {
  breadcrumb: "Pricing",
  to: path.to.salesPriceLists
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    role: "employee"
  });

  return null;
}

export default function PriceListLayout() {
  return <Outlet />;
}
