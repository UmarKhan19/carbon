import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type {
  ChangeOrder,
  ChangeOrderActionTask,
  ChangeOrderImpactRow
} from "~/modules/items";
import { canEditChangeOrder } from "~/modules/items";
import type { ChangeOrderDiff } from "~/modules/items/changeOrder.diff";
import type { ChangeOrderSupersessionWithLabels } from "~/modules/items/changeOrder.staging";
import type { AffectedItemStaging } from "~/modules/items/ui/ChangeOrder";
import {
  AffectedItems,
  ChangeOrderActions,
  ChangeOrderContent,
  ChangeOrderReview,
  ChangeOrderSupersession,
  ImpactPanel,
  ImplementationSection
} from "~/modules/items/ui/ChangeOrder";
import { path } from "~/utils/path";

export default function ChangeOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    affectedItems: AffectedItemStaging[];
    diff: ChangeOrderDiff;
    supersessions: ChangeOrderSupersessionWithLabels[];
    actions: ChangeOrderActionTask[];
    impact: ChangeOrderImpactRow[];
  }>(path.to.changeOrder(id));
  const changeOrder = routeData?.changeOrder;

  if (!changeOrder) throw new Error("Could not find change order data");

  const isDisabled = !canEditChangeOrder(changeOrder.status);
  const showImplementation =
    changeOrder.status === "Implementation" || changeOrder.status === "Done";

  const affectedItems = routeData?.affectedItems ?? [];

  // In the top-to-bottom model the affected items are the changed products.
  const products = affectedItems.map((a) => ({
    id: a.affectedItem.id,
    itemId: a.affectedItem.itemId,
    item: a.affectedItem.item
      ? {
          readableIdWithRevision: a.affectedItem.item.readableIdWithRevision,
          name: a.affectedItem.item.name
        }
      : null
  }));

  return (
    <VStack spacing={2}>
      <ChangeOrderContent
        key={id}
        id={id}
        reasonForChange={changeOrder.reasonForChange as JSONContent}
        description={changeOrder.description as JSONContent}
        isDisabled={isDisabled}
      />

      <AffectedItems
        id={id}
        affectedItems={affectedItems}
        isDisabled={isDisabled}
      />

      <ChangeOrderSupersession
        id={id}
        supersessions={routeData?.supersessions ?? []}
        isDisabled={isDisabled}
      />

      <ChangeOrderActions
        changeOrderId={id}
        actions={routeData?.actions ?? []}
        isDisabled={isDisabled}
      />

      {showImplementation && (
        <>
          <ChangeOrderReview
            diff={routeData?.diff ?? { items: [], supersessions: [] }}
          />
          <ImplementationSection
            changeOrderId={id}
            effectiveDate={changeOrder.effectiveDate ?? null}
            status={changeOrder.status}
            products={products}
          />
          <ImpactPanel impact={routeData?.impact ?? []} />
        </>
      )}
    </VStack>
  );
}
