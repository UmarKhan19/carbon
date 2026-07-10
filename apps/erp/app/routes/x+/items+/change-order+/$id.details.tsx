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
import type {
  BomChangeRow,
  ProductAffected
} from "~/modules/items/ui/ChangeOrder";
import {
  BomChanges,
  ChangeOrderActions,
  ChangeOrderContent,
  ImpactPanel,
  ImplementationSection,
  ProductsAffected
} from "~/modules/items/ui/ChangeOrder";
import { path } from "~/utils/path";

export default function ChangeOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    productsAffected: ProductAffected[];
    bomChanges: BomChangeRow[];
    suggestedAssembliesByRow: Record<
      string,
      { value: string; label: string }[]
    >;
    actions: ChangeOrderActionTask[];
    impact: ChangeOrderImpactRow[];
  }>(path.to.changeOrder(id));
  const changeOrder = routeData?.changeOrder;

  if (!changeOrder) throw new Error("Could not find change order data");

  const isDisabled = !canEditChangeOrder(changeOrder.status);
  const showImplementation =
    changeOrder.status === "Implementation" || changeOrder.status === "Done";

  return (
    <VStack spacing={2}>
      <ChangeOrderContent
        key={id}
        id={id}
        reasonForChange={changeOrder.reasonForChange as JSONContent}
        description={changeOrder.description as JSONContent}
        isDisabled={isDisabled}
      />

      <ProductsAffected products={routeData?.productsAffected ?? []} />

      <BomChanges
        changeOrderId={id}
        rows={routeData?.bomChanges ?? []}
        suggestedAssembliesByRow={routeData?.suggestedAssembliesByRow ?? {}}
        isDisabled={isDisabled}
      />

      <ChangeOrderActions
        changeOrderId={id}
        actions={routeData?.actions ?? []}
        isDisabled={isDisabled}
      />

      {showImplementation && (
        <>
          <ImplementationSection
            changeOrderId={id}
            effectiveDate={changeOrder.effectiveDate ?? null}
            status={changeOrder.status}
            products={routeData?.productsAffected ?? []}
          />
          <ImpactPanel impact={routeData?.impact ?? []} />
        </>
      )}
    </VStack>
  );
}
