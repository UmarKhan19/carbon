import type { Database } from "@carbon/database";
import type {
  getChangeOrder,
  getChangeOrderApprovalTasks,
  getChangeOrderItems,
  getChangeOrderReviewers,
  getChangeOrders,
  getChangeOrderType,
  getChangeOrderTypes,
  getChangeOrderWorkflow,
  getChangeOrderWorkflows
} from "./changeOrder.service";

export type ChangeOrder = NonNullable<
  Awaited<ReturnType<typeof getChangeOrders>>["data"]
>[number];

export type ChangeOrderDetail = NonNullable<
  Awaited<ReturnType<typeof getChangeOrder>>["data"]
>;

export type ChangeOrderItem = NonNullable<
  Awaited<ReturnType<typeof getChangeOrderItems>>["data"]
>[number];

export type ChangeOrderApprovalTask = NonNullable<
  Awaited<ReturnType<typeof getChangeOrderApprovalTasks>>["data"]
>[number];

export type ChangeOrderReviewer = NonNullable<
  Awaited<ReturnType<typeof getChangeOrderReviewers>>["data"]
>[number];

export type ChangeOrderType = NonNullable<
  Awaited<ReturnType<typeof getChangeOrderTypes>>["data"]
>[number];

export type ChangeOrderTypeDetail = NonNullable<
  Awaited<ReturnType<typeof getChangeOrderType>>["data"]
>;

export type ChangeOrderWorkflow = NonNullable<
  Awaited<ReturnType<typeof getChangeOrderWorkflows>>["data"]
>[number];

export type ChangeOrderWorkflowDetail = NonNullable<
  Awaited<ReturnType<typeof getChangeOrderWorkflow>>["data"]
>;

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
