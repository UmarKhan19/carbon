import type { Database } from "@carbon/database";
import type { JobMaterialPurchaseOrderLine } from "./types";

export type PurchaseOrderStatus =
  Database["public"]["Enums"]["purchaseOrderStatus"];

export type ItemOrderStatus = {
  needsOrder: boolean;
  shortfall: number;
  status: PurchaseOrderStatus | null;
  ordered: number;
  received: number;
};

export type JobOrderStatusCategory =
  | "needsOrder"
  | "planned"
  | "awaitingApproval"
  | "onOrder"
  | "received";

// Must match the demand window in get_job_quantity_on_hand and the scheduling
// sequence.
export const ACTIVE_JOB_STATUSES: Database["public"]["Enums"]["jobStatus"][] = [
  "Planned",
  "Ready",
  "In Progress",
  "Paused"
];

// Explicit list, not the complement of ACTIVE_JOB_STATUSES — active-but-late
// states like Overdue still surface indicators.
const JOB_STATUSES_WITHOUT_ORDER_STATUS = [
  "Draft",
  "Completed",
  "Cancelled",
  "Closed"
];

export function isJobOrderStatusHidden(
  jobStatus: string | null | undefined
): boolean {
  return !!jobStatus && JOB_STATUSES_WITHOUT_ORDER_STATUS.includes(jobStatus);
}

// Highest priority first. Draft, cancelled, closed and rejected are
// intentionally excluded — a dead PO isn't a real order.
export const PO_STATUS_PRIORITY: PurchaseOrderStatus[] = [
  "To Receive",
  "To Receive and Invoice",
  "Needs Approval",
  "To Review",
  "Planned",
  "To Invoice",
  "Completed"
];

type OrderStatusMaterial = {
  itemTrackingType: string | null;
  methodType: string | null;
};

export function getJobMaterialOrderStatus(
  material: OrderStatusMaterial,
  poLines: JobMaterialPurchaseOrderLine[],
  shortfall: number
): ItemOrderStatus {
  const needsOrder =
    material.itemTrackingType !== "Non-Inventory" &&
    material.methodType !== "Make to Order" &&
    shortfall > 0;

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

  return { needsOrder, shortfall, status, ordered, received };
}

// Must stay in lockstep with JobOrderStatusBadge's precedence so the status
// filter and the badge never disagree.
export function getJobOrderStatusCategory(
  status: ItemOrderStatus | undefined
): JobOrderStatusCategory | null {
  switch (status?.status) {
    case "Planned":
      return "planned";
    case "Needs Approval":
    case "To Review":
      return "awaitingApproval";
    case "To Receive":
    case "To Receive and Invoice": {
      // In-flight (not yet fully received) outranks the needs-ordering dot.
      const fraction =
        status.ordered > 0 ? status.received / status.ordered : 0;
      if (fraction < 1) return "onOrder";
      break;
    }
  }

  if (status?.needsOrder) return "needsOrder";
  if (
    status?.status === "To Receive" ||
    status?.status === "To Receive and Invoice" ||
    status?.status === "To Invoice" ||
    status?.status === "Completed"
  )
    return "received";
  return null;
}

type OrderStatusBuildMaterial = OrderStatusMaterial & {
  id: string | null;
  jobMaterialItemId: string | null;
};

// One status per material id (= the tree node's methodMaterialId) — the single
// source the table, tree, and filter all read from.
export function getJobOrderStatusByMaterial(
  materials: OrderStatusBuildMaterial[],
  purchaseOrderLines: JobMaterialPurchaseOrderLine[],
  shortfallByItemId: Record<string, number>
): Record<string, ItemOrderStatus> {
  const linesByItemId = new Map<string, JobMaterialPurchaseOrderLine[]>();
  for (const line of purchaseOrderLines) {
    if (!line.itemId) continue;
    const lines = linesByItemId.get(line.itemId) ?? [];
    lines.push(line);
    linesByItemId.set(line.itemId, lines);
  }

  const byMaterialId: Record<string, ItemOrderStatus> = {};
  for (const material of materials) {
    if (!material.id) continue;
    const poLines = material.jobMaterialItemId
      ? (linesByItemId.get(material.jobMaterialItemId) ?? [])
      : [];
    const shortfall = material.jobMaterialItemId
      ? (shortfallByItemId[material.jobMaterialItemId] ?? 0)
      : 0;
    byMaterialId[material.id] = getJobMaterialOrderStatus(
      material,
      poLines,
      shortfall
    );
  }
  return byMaterialId;
}
