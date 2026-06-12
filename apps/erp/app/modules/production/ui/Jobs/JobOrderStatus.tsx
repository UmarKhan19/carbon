import type { Database } from "@carbon/database";
import {
  PulsingDot,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCircleCheck } from "react-icons/lu";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import type { JobMaterialPurchaseOrderLine } from "../../types";

export type PurchaseOrderStatus =
  Database["public"]["Enums"]["purchaseOrderStatus"];

// The item+location scoped PO line shape lives in the production module's types
// (produced by getJobMaterialPurchaseOrderLines); re-exported under the name the
// tree and table already use.
export type JobPurchaseOrderLine = JobMaterialPurchaseOrderLine;

// Procurement status surfaced for a job material.
//   needsOrder — shortfall (same predicate as the Materials page "create order");
//                shown as the pulsing dot when there's no active PO.
//   status     — the most relevant active PO, with its receipt quantities.
export type ItemOrderStatus = {
  needsOrder: boolean;
  status: PurchaseOrderStatus | null;
  ordered: number;
  received: number;
};

// When an item has several POs, surface the most relevant one: prefer an active
// (in-flight) order over a received one, advancing planned → receipt. Draft,
// cancelled, closed and rejected statuses are intentionally absent — an
// unsubmitted/dead PO isn't a real order, so it counts as "no active PO".
export const PO_STATUS_PRIORITY: PurchaseOrderStatus[] = [
  "To Receive",
  "To Receive and Invoice",
  "Needs Approval",
  "To Review",
  "Planned",
  "To Invoice",
  "Completed"
];

// Only the quantity-on-hand fields the shortfall predicate needs.
type OrderStatusMaterial = {
  itemTrackingType: string | null;
  methodType: string | null;
  quantityOnHandInStorageUnit: number | null;
  quantityOnHandNotInStorageUnit: number | null;
  quantityOnPurchaseOrder: number | null;
  quantityOnProductionOrder: number | null;
  quantityFromProductionOrderInStorageUnit: number | null;
  quantityFromProductionOrderNotInStorageUnit: number | null;
  quantityOnSalesOrder: number | null;
};

// Compute the procurement status for one material from its PO lines.
export function getJobMaterialOrderStatus(
  material: OrderStatusMaterial,
  poLines: JobPurchaseOrderLine[]
): ItemOrderStatus {
  const onHand =
    (material.quantityOnHandInStorageUnit ?? 0) +
    (material.quantityOnHandNotInStorageUnit ?? 0);
  const incoming =
    (material.quantityOnPurchaseOrder ?? 0) +
    (material.quantityOnProductionOrder ?? 0);
  const required =
    (material.quantityFromProductionOrderInStorageUnit ?? 0) +
    (material.quantityFromProductionOrderNotInStorageUnit ?? 0) +
    (material.quantityOnSalesOrder ?? 0);
  const needsOrder =
    material.itemTrackingType !== "Non-Inventory" &&
    material.methodType !== "Make to Order" &&
    onHand + incoming - required < 0;

  const status =
    PO_STATUS_PRIORITY.find((candidate) =>
      poLines.some((line) => line.status === candidate)
    ) ?? null;

  let ordered = 0;
  let received = 0;
  if (status) {
    for (const line of poLines) {
      if (line.status !== status) continue;
      ordered += line.purchaseQuantity ?? 0;
      received += line.quantityReceived ?? 0;
    }
  }

  return { needsOrder, status, ordered, received };
}

// The procurement status badge, shared by the BoM tree and the Materials table.
// An in-flight purchase order takes priority over the needs-ordering dot.
export function JobOrderStatusBadge({
  status,
  jobQuantity
}: {
  status: ItemOrderStatus | undefined;
  jobQuantity: number;
}) {
  const badge = (icon: ReactNode, label: ReactNode) => (
    <Tooltip>
      <TooltipTrigger className="flex w-5 items-center justify-center">
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  switch (status?.status) {
    case "Planned":
      return badge(
        <TodoStatusIcon className="text-blue-600" />,
        <Trans>Planned purchase order</Trans>
      );
    case "Needs Approval":
    case "To Review":
      return badge(<InProgressStatusIcon />, <Trans>Awaiting approval</Trans>);
    case "To Receive":
    case "To Receive and Invoice": {
      const fraction =
        status.ordered > 0 ? status.received / status.ordered : 0;
      if (fraction >= 1) {
        return badge(
          <LuCircleCheck className="text-emerald-600" />,
          <Trans>Received</Trans>
        );
      }
      if (status.received > 0) {
        return badge(<AlmostDoneIcon />, <Trans>Receiving</Trans>);
      }
      return badge(<AlmostDoneIcon />, <Trans>On order</Trans>);
    }
  }

  // No in-flight PO. If there's still a shortfall, it needs ordering.
  if (status?.needsOrder) {
    return (
      <Tooltip>
        <TooltipTrigger className="flex w-5 items-center justify-center">
          <PulsingDot />
        </TooltipTrigger>
        <TooltipContent>
          <Trans>Order {jobQuantity} for this job</Trans>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Already received (To Invoice / Completed) and no new shortfall.
  if (status?.status === "To Invoice" || status?.status === "Completed") {
    return badge(
      <LuCircleCheck className="text-emerald-600" />,
      <Trans>Received</Trans>
    );
  }

  return null;
}
