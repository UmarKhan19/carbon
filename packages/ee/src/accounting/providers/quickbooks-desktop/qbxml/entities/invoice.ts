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
 * InvoiceAdd / InvoiceQuery builders + InvoiceRet parser. Transactions are
 * push-only in v1 — no Mod (a changed Carbon invoice is a new sync
 * decision, not an in-place edit in QuickBooks).
 *
 * - RefNumber = fitRefNumber(readableId): included only when the readable
 *   id fits 11 chars (RefNumber uniqueness is NOT enforced by the SDK).
 * - Memo always stamps `Carbon <readableId> <entityId>` — the readable id
 *   lives ONLY there when it did not fit RefNumber.
 * - CustomerRef by ListID from the customer mapping (FullName fallback
 *   pre-resolution); a missing ref is a dependency-sync bug (plain Error).
 * - Query-before-insert: buildQueryRq by RefNumber, or by TxnDate range +
 *   caller-side Memo scan when the RefNumber did not fit.
 *
 * Element order per the OSR: CustomerRef, TxnDate, RefNumber, DueDate,
 * Memo, InvoiceLineAdd*.
 */

export interface QbdInvoiceLineInput {
  /** Line item (mapped ListID); omit for a description-only line. */
  itemRef?: QbdRef | null;
  description?: string | null;
  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;
}

export interface QbdInvoiceInput {
  customerRef: QbdRef;
  /** YYYY-MM-DD. */
  txnDate: string;
  dueDate?: string | null;
  /** Human-readable invoice number → RefNumber (when ≤ 11) + Memo. */
  readableId: string;
  /** Carbon invoice id → Memo. */
  entityId: string;
  lines: QbdInvoiceLineInput[];
}

function buildLineXml(line: QbdInvoiceLineInput): string {
  return `<InvoiceLineAdd>${
    line.itemRef
      ? buildEntityRefXml("ItemRef", line.itemRef, "invoice line item")
      : ""
  }${optionalElement("Desc", line.description)}${
    line.quantity != null
      ? element("Quantity", formatQuantity(line.quantity))
      : ""
  }${line.rate != null ? element("Rate", formatAmount(line.rate)) : ""}${
    line.amount != null ? element("Amount", formatAmount(line.amount)) : ""
  }</InvoiceLineAdd>`;
}

export function buildAddRq(args: {
  requestID: string;
  invoice: QbdInvoiceInput;
}): string {
  const { invoice } = args;
  const refNumber = fitRefNumber(invoice.readableId);
  const memo = buildCarbonMemo(invoice.readableId, invoice.entityId);

  const inner = `<InvoiceAdd>${buildEntityRefXml(
    "CustomerRef",
    invoice.customerRef,
    "customer"
  )}${element("TxnDate", formatDate(invoice.txnDate))}${
    refNumber ? element("RefNumber", refNumber) : ""
  }${
    invoice.dueDate ? element("DueDate", formatDate(invoice.dueDate)) : ""
  }${element("Memo", memo)}${invoice.lines
    .map((line) => buildLineXml(line))
    .join("")}</InvoiceAdd>`;

  return buildRequestElement("InvoiceAddRq", args.requestID, inner);
}

export function buildQueryRq(args: QbdTxnQueryArgs): string {
  return buildTxnQueryRqXml("InvoiceQueryRq", args);
}

export function parseRet(payload: unknown): QbdTxnRet | null {
  return parseTxnRet(payload, "InvoiceRet");
}
