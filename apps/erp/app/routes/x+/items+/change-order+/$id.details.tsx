import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type {
  ChangeOrder,
  ChangeOrderActionTask,
  ChangeOrderImpact,
  ChangeOrderReleaseConflict
} from "~/modules/items";
import { canEditChangeOrder } from "~/modules/items";
import type { ChangeOrderDiff } from "~/modules/items/changeOrder.diff";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeOrder";
import {
  AffectedItems,
  ChangeOrderActions,
  ChangeOrderContent,
  ChangeOrderReleaseMerge,
  ImpactPanel
} from "~/modules/items/ui/ChangeOrder";
import { path } from "~/utils/path";

export default function ChangeOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    affectedItems: AffectedItemDraft[];
    diff: ChangeOrderDiff;
    releaseConflicts: ChangeOrderReleaseConflict[];
    actions: ChangeOrderActionTask[];
    impact: ChangeOrderImpact;
  }>(path.to.changeOrder(id));
  const changeOrder = routeData?.changeOrder;

  if (!changeOrder) throw new Error("Could not find change order data");

  const isDisabled = !canEditChangeOrder(changeOrder.status);
  const showImplementation =
    changeOrder.status === "Implementation" || changeOrder.status === "Done";

  const affectedItems = routeData?.affectedItems ?? [];

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

      <ChangeOrderActions
        changeOrderId={id}
        actions={routeData?.actions ?? []}
        isDisabled={isDisabled}
      />

      {showImplementation && (
        <>
          <ImpactPanel
            impact={
              routeData?.impact ?? {
                removedParts: [],
                affectedJobs: [],
                supersededSalesOrders: []
              }
            }
          />
          <ChangeOrderReleaseMerge
            changeOrderId={id}
            status={changeOrder.status}
            conflicts={routeData?.releaseConflicts ?? []}
          />
        </>
      )}
    </VStack>
  );
}
