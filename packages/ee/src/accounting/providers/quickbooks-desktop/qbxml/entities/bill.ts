import { buildRequestElement } from "../envelope";
import {
  buildAccountRefXml,
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
 * BillAdd / BillQuery builders + BillRet parser (push-only v1, no Mod).
 *
 * A bill carries expense lines (mapped G/L AccountRef — UNMAPPED_ACCOUNTS
 * Warning when unmapped) and/or item lines (ItemRef from the item
 * mapping); at least one line is required. Memo stamps
 * `Carbon <readableId> <entityId>`; RefNumber via fitRefNumber (the
 * vendor's bill number when it fits 11 chars).
 *
 * Element order per the OSR — note DueDate precedes RefNumber on BillAdd
 * (unlike InvoiceAdd): VendorRef, TxnDate, DueDate, RefNumber, Memo,
 * ExpenseLineAdd*, ItemLineAdd*.
 */

export interface QbdBillExpenseLineInput {
  accountRef: QbdRef;
  amount: number;
  memo?: string | null;
}

export interface QbdBillItemLineInput {
  itemRef: QbdRef;
  description?: string | null;
  quantity?: number | null;
  cost?: number | null;
  amount?: number | null;
}

export interface QbdBillInput {
  vendorRef: QbdRef;
  /** YYYY-MM-DD. */
  txnDate: string;
  dueDate?: string | null;
  /** Human-readable bill/invoice number → RefNumber (when ≤ 11) + Memo. */
  readableId: string;
  /** Carbon purchase-invoice id → Memo. */
  entityId: string;
  expenseLines?: QbdBillExpenseLineInput[];
  itemLines?: QbdBillItemLineInput[];
}

function buildExpenseLineXml(
  line: QbdBillExpenseLineInput,
  index: number
): string {
  return `<ExpenseLineAdd>${buildAccountRefXml(
    "AccountRef",
    line.accountRef,
    `bill expense line ${index + 1}`
  )}${element("Amount", formatAmount(line.amount))}${optionalElement(
    "Memo",
    line.memo
  )}</ExpenseLineAdd>`;
}

function buildItemLineXml(line: QbdBillItemLineInput): string {
  return `<ItemLineAdd>${buildEntityRefXml(
    "ItemRef",
    line.itemRef,
    "bill line item"
  )}${optionalElement("Desc", line.description)}${
    line.quantity != null
      ? element("Quantity", formatQuantity(line.quantity))
      : ""
  }${line.cost != null ? element("Cost", formatAmount(line.cost)) : ""}${
    line.amount != null ? element("Amount", formatAmount(line.amount)) : ""
  }</ItemLineAdd>`;
}

export function buildAddRq(args: {
  requestID: string;
  bill: QbdBillInput;
}): string {
  const { bill } = args;
  const expenseLines = bill.expenseLines ?? [];
  const itemLines = bill.itemLines ?? [];
  if (expenseLines.length === 0 && itemLines.length === 0) {
    throw new Error(
      `Cannot build BillAdd for ${bill.readableId}: a bill needs at least one expense or item line`
    );
  }

  const refNumber = fitRefNumber(bill.readableId);
  const memo = buildCarbonMemo(bill.readableId, bill.entityId);

  const inner = `<BillAdd>${buildEntityRefXml(
    "VendorRef",
    bill.vendorRef,
    "vendor"
  )}${element("TxnDate", formatDate(bill.txnDate))}${
    bill.dueDate ? element("DueDate", formatDate(bill.dueDate)) : ""
  }${refNumber ? element("RefNumber", refNumber) : ""}${element(
    "Memo",
    memo
  )}${expenseLines
    .map((line, index) => buildExpenseLineXml(line, index))
    .join("")}${itemLines
    .map((line) => buildItemLineXml(line))
    .join("")}</BillAdd>`;

  return buildRequestElement("BillAddRq", args.requestID, inner);
}

export function buildQueryRq(args: QbdTxnQueryArgs): string {
  return buildTxnQueryRqXml("BillQueryRq", args);
}

export function parseRet(payload: unknown): QbdTxnRet | null {
  return parseTxnRet(payload, "BillRet");
}
