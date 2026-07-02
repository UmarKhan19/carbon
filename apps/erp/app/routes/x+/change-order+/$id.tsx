import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getChangeOrder,
  getChangeOrderItems,
  getChangeOrderTypesList
} from "~/modules/items";
import ChangeOrderHeader from "~/modules/items/ui/ChangeOrder/ChangeOrderHeader";
import ChangeOrderItemsTree from "~/modules/items/ui/ChangeOrder/ChangeOrderItemsTree";
import ChangeOrderProperties from "~/modules/items/ui/ChangeOrder/ChangeOrderProperties";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Change Orders`,
  to: path.to.changeOrders,
  module: "items"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [changeOrder, items, changeOrderTypes] = await Promise.all([
    getChangeOrder(client, id, companyId),
    getChangeOrderItems(client, id, companyId),
    getChangeOrderTypesList(client, companyId)
  ]);

  if (changeOrder.error) {
    throw redirect(
      path.to.changeOrders,
      await flash(
        request,
        error(changeOrder.error, "Failed to load change order")
      )
    );
  }

  return {
    changeOrder: changeOrder.data,
    items: items.data ?? [],
    changeOrderTypes: changeOrderTypes.data ?? []
  };
}

export default function ChangeOrderRoute() {
  const { items } = useLoaderData<typeof loader>();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <ChangeOrderHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={
                <ChangeOrderItemsTree
                  key={id}
                  changeOrderId={id}
                  items={items}
                />
              }
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<ChangeOrderProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
