import type { Database } from "@carbon/database";

// =============================================================================
// Enum-derived types — safe in Phase 0 because they derive directly from the
// generated DB enums, not from service getters. Getter-inferred types
// (ChangeOrder, ChangeOrderDetail, ChangeOrderItem, ...) are deferred to the
// phase that adds the getChangeOrder*() services and are added to this file in
// place.
// =============================================================================

export type ChangeOrderStatusType =
  Database["public"]["Enums"]["changeOrderStatus"];

export type ChangeOrderTypeEnum =
  Database["public"]["Enums"]["changeOrderTypeEnum"];

export type ChangeOrderApprovalTypeEnum =
  Database["public"]["Enums"]["changeOrderApprovalType"];

export type ChangeOrderDispositionEnum =
  Database["public"]["Enums"]["changeOrderDisposition"];

export type ItemRevisionStatus =
  Database["public"]["Enums"]["itemRevisionStatus"];

export type ChangeOrderTaskStatusEnum =
  Database["public"]["Enums"]["changeOrderTaskStatus"];
