import { buildRequestElement } from "../envelope";
import {
  buildCarbonMemo,
  buildEntityRefXml,
  buildTxnQueryRqXml,
  element,
  fitRefNumber,
  formatAmount,
  formatDate,
  formatQuantity,
  optionalElement,
  parseTxnRet,
  type QbdRef,
  type QbdTxnQueryArgs,
  type QbdTxnRet
} from "./shared";

/**
 * PurchaseOrderAdd / PurchaseOrderQuery builders + PurchaseOrderRet parser
 * (push-only v1, no Mod).
 *
 * RefNumber = fitRefNumber(readableId) (Carbon PO number, when ≤ 11
 * chars); Memo always stamps `Carbon <readableId> <entityId>`. VendorRef
 * and line ItemRefs come from the mappings by ListID (FullName fallback
 * pre-resolution).
 *
 * Element order per the OSR: VendorRef, TxnDate, RefNumber, DueDate,
 * ExpectedDate, Memo, PurchaseOrderLineAdd*.
 */

export interface QbdPurchaseOrderLineInput {
  /** Line item (mapped ListID); omit for a description-only line. */
  itemRef?: QbdRef | null;
  description?: string | null;
  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;
}

export interface QbdPurchaseOrderInput {
  vendorRef: QbdRef;
  /** YYYY-MM-DD. */
  txnDate: string;
  dueDate?: string | null;
  expectedDate?: string | null;
  /** Human-readable PO number → RefNumber (when ≤ 11) + Memo. */
  readableId: string;
  /** Carbon purchase-order id → Memo. */
  entityId: string;
  lines: QbdPurchaseOrderLineInput[];
}

function buildLineXml(line: QbdPurchaseOrderLineInput): string {
  return `<PurchaseOrderLineAdd>${
    line.itemRef
      ? buildEntityRefXml("ItemRef", line.itemRef, "purchase order line item")
      : ""
  }${optionalElement("Desc", line.description)}${
    line.quantity != null
      ? element("Quantity", formatQuantity(line.quantity))
      : ""
  }${line.rate != null ? element("Rate", formatAmount(line.rate)) : ""}${
    line.amount != null ? element("Amount", formatAmount(line.amount)) : ""
  }</PurchaseOrderLineAdd>`;
}

export function buildAddRq(args: {
  requestID: string;
  purchaseOrder: QbdPurchaseOrderInput;
}): string {
  const { purchaseOrder } = args;
  const refNumber = fitRefNumber(purchaseOrder.readableId);
  const memo = buildCarbonMemo(
    purchaseOrder.readableId,
    purchaseOrder.entityId
  );

  const inner = `<PurchaseOrderAdd>${buildEntityRefXml(
    "VendorRef",
    purchaseOrder.vendorRef,
    "vendor"
  )}${element("TxnDate", formatDate(purchaseOrder.txnDate))}${
    refNumber ? element("RefNumber", refNumber) : ""
  }${
    purchaseOrder.dueDate
      ? element("DueDate", formatDate(purchaseOrder.dueDate))
      : ""
  }${
    purchaseOrder.expectedDate
      ? element("ExpectedDate", formatDate(purchaseOrder.expectedDate))
      : ""
  }${element("Memo", memo)}${purchaseOrder.lines
    .map((line) => buildLineXml(line))
    .join("")}</PurchaseOrderAdd>`;

  return buildRequestElement("PurchaseOrderAddRq", args.requestID, inner);
}

export function buildQueryRq(args: QbdTxnQueryArgs): string {
  return buildTxnQueryRqXml("PurchaseOrderQueryRq", args);
}

export function parseRet(payload: unknown): QbdTxnRet | null {
  return parseTxnRet(payload, "PurchaseOrderRet");
}
