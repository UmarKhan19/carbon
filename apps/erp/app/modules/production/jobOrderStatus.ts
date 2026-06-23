import type { Database } from "@carbon/database";
import type {
  JobMaterialPurchaseOrderLine,
  JobMaterialSupplyJobLine
} from "./types";

export type PurchaseOrderStatus =
  Database["public"]["Enums"]["purchaseOrderStatus"];

export type JobStatus = Database["public"]["Enums"]["jobStatus"];

export type ItemOrderStatus = {
  needsOrder: boolean;
  shortfall: number;
  status: PurchaseOrderStatus | null;
  // Highest-priority active job producing this (manufactured) item, if any. The
  // supply-side counterpart to `status`; lets a planned/in-flight job surface a
  // positive indicator instead of a bare "needs order" dot.
  supplyJobStatus: JobStatus | null;
  // The owning job is Completed — procurement status is moot, so every material
  // shows a single "Completed" badge instead of per-material indicators.
  jobCompleted: boolean;
  // This job's full requirement is met from on-hand stock (after priority
  // allocation) — i.e. the parts are already in inventory, not merely on order.
  // Lets a fulfilled high-priority job show "in stock" while a lower-priority job
  // sharing the same partially-received PO still shows "receiving".
  coveredByOnHand: boolean;
  ordered: number;
  received: number;
};

export type JobOrderStatusCategory =
  | "needsOrder"
  | "planned"
  | "plannedJob"
  | "awaitingApproval"
  | "onOrder"
  | "received"
  | "completed";

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

// PO statuses whose quantity is NOT yet counted in `quantityOnPurchaseOrder`
// (the get_job_quantity_on_hand RPC only counts 'To Receive' /
// 'To Receive and Invoice'), but which still represent incoming supply the badge
// treats as coverage. The shortfall allocator adds these so a planned PO is
// handed out to the highest-priority job first — matching how planned *jobs*
// already count (the RPC's production CTE includes 'Planned'). 'To Invoice' /
// 'Completed' are excluded — those goods are received and already in on-hand.
export const PENDING_PO_SUPPLY_STATUSES: PurchaseOrderStatus[] = [
  "Planned",
  "Needs Approval",
  "To Review"
];

type OrderStatusMaterial = {
  itemTrackingType: string | null;
  methodType: string | null;
};

// Highest priority first — picks the representative supply-job status when an
// item is produced by more than one active job. In-flight states outrank merely
// planned ones, mirroring PO_STATUS_PRIORITY.
export const JOB_SUPPLY_STATUS_PRIORITY: JobStatus[] = [
  "In Progress",
  "Paused",
  "Ready",
  "Planned"
];

export function getJobMaterialOrderStatus(
  material: OrderStatusMaterial,
  poLines: JobMaterialPurchaseOrderLine[],
  supplyJobLines: JobMaterialSupplyJobLine[],
  shortfall: number,
  coveredByOnHand: boolean
): ItemOrderStatus {
  const needsOrder =
    material.itemTrackingType !== "Non-Inventory" &&
    material.methodType !== "Make to Order" &&
    shortfall > 0;

  const status =
    PO_STATUS_PRIORITY.find((candidate) =>
      poLines.some((line) => line.status === candidate)
    ) ?? null;

  const supplyJobStatus =
    JOB_SUPPLY_STATUS_PRIORITY.find((candidate) =>
      supplyJobLines.some((line) => line.status === candidate)
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

  return {
    needsOrder,
    shortfall,
    status,
    supplyJobStatus,
    jobCompleted: false,
    coveredByOnHand,
    ordered,
    received
  };
}

// A uniform "Completed" status for every material of a finished job. Skips the
// PO/supply/shortfall math — procurement state is irrelevant once the job is done.
export function getCompletedJobOrderStatus(): ItemOrderStatus {
  return {
    needsOrder: false,
    shortfall: 0,
    status: null,
    supplyJobStatus: null,
    jobCompleted: true,
    coveredByOnHand: false,
    ordered: 0,
    received: 0
  };
}

// The single source of truth for order-status precedence. Both the status filter
// and JobOrderStatusBadge derive from this (the badge maps each category to its
// icon/label), so they can never disagree. Order of the checks below IS the
// precedence — keep the highest-priority indicator first.
export function getJobOrderStatusCategory(
  status: ItemOrderStatus | undefined
): JobOrderStatusCategory | null {
  // A completed job and a need fully met from on-hand stock both render the same
  // green "check" badge ("Completed" / "In stock"), so they share the
  // "completed" filter category.
  if (status?.jobCompleted) return "completed";

  // A still-unmet, priority-adjusted shortfall outranks the supply indicators —
  // see JobOrderStatusBadge for why.
  if (status?.needsOrder) return "needsOrder";

  // This job's need is already met from on-hand stock ("In stock" green check) —
  // outranks any "on order" indicator from a PO that's only partially received
  // for other jobs.
  if (status?.coveredByOnHand) return "completed";

  switch (status?.status) {
    case "Planned":
      return "planned";
    case "Needs Approval":
    case "To Review":
      return "awaitingApproval";
    case "To Receive":
    case "To Receive and Invoice": {
      const fraction =
        status.ordered > 0 ? status.received / status.ordered : 0;
      if (fraction < 1) {
        // Some already received ("Received X of Y" badge) vs nothing yet
        // ("On order").
        return status.received > 0 ? "received" : "onOrder";
      }
      break;
    }
  }

  if (status?.supplyJobStatus) return "plannedJob";
  return null;
}

type OrderStatusBuildMaterial = OrderStatusMaterial & {
  id: string | null;
  jobMaterialItemId: string | null;
};

// One status per material id (= the tree node's methodMaterialId) — the single
// source the table, tree, and filter all read from.
export type ItemShortfall = {
  shortfall: number;
  // True when this job's whole requirement is met from on-hand stock (no
  // reliance on incoming PO/job supply) after priority allocation.
  coveredByOnHand: boolean;
};

export function getJobOrderStatusByMaterial(
  materials: OrderStatusBuildMaterial[],
  purchaseOrderLines: JobMaterialPurchaseOrderLine[],
  supplyJobLines: JobMaterialSupplyJobLine[],
  shortfallByItemId: Record<string, ItemShortfall>
): Record<string, ItemOrderStatus> {
  const linesByItemId = new Map<string, JobMaterialPurchaseOrderLine[]>();
  for (const line of purchaseOrderLines) {
    if (!line.itemId) continue;
    const lines = linesByItemId.get(line.itemId) ?? [];
    lines.push(line);
    linesByItemId.set(line.itemId, lines);
  }

  const jobLinesByItemId = new Map<string, JobMaterialSupplyJobLine[]>();
  for (const line of supplyJobLines) {
    if (!line.itemId) continue;
    const lines = jobLinesByItemId.get(line.itemId) ?? [];
    lines.push(line);
    jobLinesByItemId.set(line.itemId, lines);
  }

  const byMaterialId: Record<string, ItemOrderStatus> = {};
  for (const material of materials) {
    if (!material.id) continue;
    const poLines = material.jobMaterialItemId
      ? (linesByItemId.get(material.jobMaterialItemId) ?? [])
      : [];
    const jobLines = material.jobMaterialItemId
      ? (jobLinesByItemId.get(material.jobMaterialItemId) ?? [])
      : [];
    const itemShortfall = material.jobMaterialItemId
      ? shortfallByItemId[material.jobMaterialItemId]
      : undefined;
    byMaterialId[material.id] = getJobMaterialOrderStatus(
      material,
      poLines,
      jobLines,
      itemShortfall?.shortfall ?? 0,
      itemShortfall?.coveredByOnHand ?? false
    );
  }
  return byMaterialId;
}
