import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { useRealtime } from "~/hooks";
import { getChangeOrders, getChangeOrderTypesList } from "~/modules/items";
import ChangeOrdersTable from "~/modules/items/ui/ChangeOrder/ChangeOrdersTable";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Change Orders`,
  to: path.to.changeOrders,
  module: "items"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [changeOrders, changeOrderTypes, tags] = await Promise.all([
    getChangeOrders(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getChangeOrderTypesList(client, companyId),
    getTagsList(client, companyId, "changeOrder")
  ]);

  if (changeOrders.error) {
    console.error(changeOrders.error);
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(changeOrders.error, "Error loading change orders")
      )
    );
  }

  return {
    changeOrders: changeOrders.data ?? [],
    count: changeOrders.count ?? 0,
    types: changeOrderTypes.data ?? [],
    tags: tags.data ?? []
  };
}

export default function ChangeOrdersRoute() {
  const { changeOrders, count } = useLoaderData<typeof loader>();

  useRealtime("changeOrder");

  return (
    <VStack spacing={0} className="h-full">
      <ChangeOrdersTable data={changeOrders} count={count} />
      <Outlet />
    </VStack>
  );
}
