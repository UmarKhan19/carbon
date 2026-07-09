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

export type ChangeOrderActionTask =
  Database["public"]["Tables"]["changeOrderActionTask"]["Row"];
