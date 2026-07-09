import type { Database } from "@carbon/database";
import type {
  getChangeOrders,
  getChangeOrderTypes
} from "./change-orders.service";

export type ChangeOrder = NonNullable<
  Awaited<ReturnType<typeof getChangeOrders>>["data"]
>[number];

export type ChangeOrderType = NonNullable<
  Awaited<ReturnType<typeof getChangeOrderTypes>>["data"]
>[number];

export type ChangeOrderStatus =
  Database["public"]["Enums"]["changeOrderStatus"];

export type ChangeOrderReviewer =
  Database["public"]["Tables"]["changeOrderReviewer"]["Row"];

export type ChangeOrderActionTask =
  Database["public"]["Tables"]["changeOrderActionTask"]["Row"];

export type ChangeOrderApprovalTask =
  Database["public"]["Tables"]["changeOrderApprovalTask"]["Row"];
