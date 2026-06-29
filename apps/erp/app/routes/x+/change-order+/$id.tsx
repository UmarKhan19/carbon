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
import {
  getChangeOrderValidations,
  getMethodSnapshot
} from "~/modules/items/changeOrder.server";
import ChangeOrderHeader from "~/modules/items/ui/ChangeOrder/ChangeOrderHeader";
import type { AffectedItemRedline } from "~/modules/items/ui/ChangeOrder/ChangeOrderItemsTree";
import ChangeOrderItemsTree from "~/modules/items/ui/ChangeOrder/ChangeOrderItemsTree";
import ChangeOrderProperties from "~/modules/items/ui/ChangeOrder/ChangeOrderProperties";
import { getRedlineCounts } from "~/modules/items/ui/ChangeOrder/RedlineDiff";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Change Orders`,
  to: path.to.changeOrders,
  module: "items"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "plm",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [changeOrder, items, changeOrderTypes, tags] = await Promise.all([
    getChangeOrder(client, id, companyId),
    getChangeOrderItems(client, id, companyId),
    getChangeOrderTypesList(client, companyId),
    getTagsList(client, companyId, "changeOrder")
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

  const affectedItems = items.data ?? [];

  // For each affected item with a pending revision, resolve the current vs
  // pending method and pre-compute the sidebar redline signal (+/−/~ counts and
  // the proposed-revision BOM materials for the nested method node). The full
  // diff body is built per-item in the focused view.
  const redlineEntries = await Promise.all(
    affectedItems
      .filter((item) => Boolean(item.pendingItemId))
      .map(async (item) => {
        const [current, pending] = await Promise.all([
          getMethodSnapshot(client, item.itemId, companyId),
          getMethodSnapshot(client, item.pendingItemId, companyId)
        ]);
        return [
          item.id,
          {
            counts: getRedlineCounts(current, pending),
            materials: pending.materials
          } satisfies AffectedItemRedline
        ] as const;
      })
  );

  const redlineByItemId = Object.fromEntries(redlineEntries);

  return {
    changeOrder: changeOrder.data,
    items: affectedItems,
    redlineByItemId,
    changeOrderTypes: changeOrderTypes.data ?? [],
    tags: tags.data ?? [],
    // Deferred: pre-release validations are streamed to the detail view.
    validations: getChangeOrderValidations(client, id, companyId)
  };
}

export default function ChangeOrderRoute() {
  const { items, redlineByItemId } = useLoaderData<typeof loader>();
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
                  redlineByItemId={redlineByItemId}
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
