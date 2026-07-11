import { roundCurrency } from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type { QbdInvoiceInput } from "../qbxml/entities/invoice";
import * as invoice from "../qbxml/entities/invoice";
import type { QbxmlResponse } from "../qbxml/parse";
import {
  type QbdBuildRequestResult,
  QbdEntitySyncer,
  type QbdOperationInput,
  type QbdProcessResponseResult
} from "./shared";

/**
 * QbdSalesInvoiceSyncer — posted Carbon sales invoices → QuickBooks
 * Desktop Invoice transactions (push-only v1, Add-only). Transaction flow
 * per entities/shared.ts: an existing mapping completes idempotently in
 * buildRequest; otherwise Add directly (no query phase — the RefNumber +
 * `Carbon <readableId> <entityId>` Memo stamp is the dedupe belt).
 *
 * CustomerRef resolves mapping-first (customer mapping ListID) with the
 * customer NAME as the FullName fallback; line ItemRefs resolve the same
 * way (item mapping ListID, item code fallback). No JIT dependency push —
 * an unresolvable name in QuickBooks comes back 3140 INVALID_REFERENCE
 * (Warning) and the operation retries after the dependency syncs.
 */

// Only posted invoices are pushed (same gate as the Xero/QBO syncers)
const SYNCABLE_STATUSES: Accounting.SalesInvoice["status"][] = [
  "Pending",
  "Submitted",
  "Partially Paid",
  "Paid",
  "Overdue"
];

/**
 * Local shape for the QBD invoice push: the shared invoice fields plus the
 * dependency names/ListIDs the qbXML refs need (customerExternalId is
 * filled from the mapping at fetch time; lines carry their item's mapped
 * ListID the same way).
 */
export type QbdSalesInvoiceLocal = Omit<Accounting.SalesInvoice, "lines"> & {
  customerName: string | null;
  lines: Array<Accounting.SalesInvoiceLine & { itemExternalId: string | null }>;
};

type InvoiceRow = {
  id: string;
  invoiceId: string;
  companyId: string;
  customerId: string;
  status: Accounting.SalesInvoice["status"];
  currencyCode: string;
  exchangeRate: number;
  dateIssued: string | null;
  dateDue: string | null;
  datePaid: string | null;
  customerReference: string | null;
  subtotal: number;
  totalTax: number;
  totalDiscount: number;
  totalAmount: number;
  balance: number | null;
  updatedAt: string | null;
  customerName: string | null;
};

type InvoiceLineRow = {
  id: string;
  invoiceLineType: string;
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  taxPercent: number | null;
  itemReadableIdWithRevision: string | null;
};

/**
 * Map a Carbon sales invoice to the QBD InvoiceAdd input. Pure — exported
 * for tests. TxnDate = dateIssued (falling back to the row's updatedAt
 * date — InvoiceAdd requires a TxnDate); readableId = the invoice number
 * (RefNumber when ≤ 11 chars, Memo always).
 */
export function toQbdInvoiceInput(
  local: QbdSalesInvoiceLocal
): QbdInvoiceInput {
  return {
    customerRef: {
      listId: local.customerExternalId ?? null,
      fullName: local.customerName ?? null
    },
    txnDate: (local.dateIssued ?? local.updatedAt).slice(0, 10),
    dueDate: local.dateDue ?? null,
    readableId: local.invoiceId,
    entityId: local.id,
    lines: local.lines.map((line) => ({
      itemRef: line.itemId
        ? { listId: line.itemExternalId, fullName: line.itemCode ?? null }
        : null,
      description: line.description ?? null,
      quantity: line.quantity,
      rate: line.unitPrice,
      amount: roundCurrency(line.quantity * line.unitPrice)
    }))
  };
}

export class QbdSalesInvoiceSyncer extends QbdEntitySyncer<QbdSalesInvoiceLocal> {
  async buildRequest(op: QbdOperationInput): Promise<QbdBuildRequestResult> {
    return this.runBuild(async () => {
      const mapping = await this.getMapping(op.entityId);
      if (mapping?.externalId) {
        return {
          outcome: "completed",
          reason:
            "Invoice already pushed to QuickBooks Desktop — skipping (idempotent)",
          externalId: mapping.externalId
        };
      }

      const local = await this.fetchLocal(op.entityId);
      if (!local) {
        throw new Error(`Sales invoice ${op.entityId} not found in Carbon`);
      }

      if (!SYNCABLE_STATUSES.includes(local.status)) {
        return {
          outcome: "completed",
          reason: `Invoice must be posted before syncing (current status: ${local.status})`
        };
      }

      return {
        outcome: "request",
        requestXml: invoice.buildAddRq({
          requestID: op.id,
          invoice: toQbdInvoiceInput(local)
        }),
        phase: "add"
      };
    });
  }

  async processResponse(
    op: QbdOperationInput,
    response: QbxmlResponse
  ): Promise<QbdProcessResponseResult> {
    return this.processTxnResponse(op, response, {
      parseRet: invoice.parseRet,
      entityLabel: "invoice"
    });
  }

  async fetchLocal(id: string): Promise<QbdSalesInvoiceLocal | null> {
    const invoiceRows = await this.database
      .selectFrom("salesInvoice")
      // `balance` is derived and lives only on the `salesInvoices` view
      .leftJoin("salesInvoices", "salesInvoices.id", "salesInvoice.id")
      .leftJoin("customer", "customer.id", "salesInvoice.customerId")
      .select([
        "salesInvoice.id",
        "salesInvoice.invoiceId",
        "salesInvoice.companyId",
        "salesInvoice.customerId",
        "salesInvoice.status",
        "salesInvoice.currencyCode",
        "salesInvoice.exchangeRate",
        "salesInvoice.dateIssued",
        "salesInvoice.dateDue",
        "salesInvoice.datePaid",
        "salesInvoice.customerReference",
        "salesInvoice.subtotal",
        "salesInvoice.totalTax",
        "salesInvoice.totalDiscount",
        "salesInvoice.totalAmount",
        "salesInvoices.balance",
        "salesInvoice.updatedAt",
        "customer.name as customerName"
      ])
      .where("salesInvoice.id", "=", id)
      .where("salesInvoice.companyId", "=", this.companyId)
      .execute();

    const row = (invoiceRows as InvoiceRow[])[0];
    if (!row) return null;

    const lineRows = await this.database
      .selectFrom("salesInvoiceLine")
      .leftJoin("item", "item.id", "salesInvoiceLine.itemId")
      .select([
        "salesInvoiceLine.id",
        "salesInvoiceLine.invoiceLineType",
        "salesInvoiceLine.itemId",
        "salesInvoiceLine.description",
        "salesInvoiceLine.quantity",
        "salesInvoiceLine.unitPrice",
        "salesInvoiceLine.taxPercent",
        "item.readableIdWithRevision as itemReadableIdWithRevision"
      ])
      .where("salesInvoiceLine.invoiceId", "=", id)
      .where("salesInvoiceLine.companyId", "=", this.companyId)
      .execute();

    // Dependency ListIDs from the mappings (customer + per-line items)
    const customerExternalId = await this.mappingService.getExternalId(
      "customer",
      row.customerId,
      this.provider.id
    );

    const itemExternalIds = new Map<string, string | null>();
    for (const line of lineRows as InvoiceLineRow[]) {
      if (line.itemId && !itemExternalIds.has(line.itemId)) {
        itemExternalIds.set(
          line.itemId,
          await this.mappingService.getExternalId(
            "item",
            line.itemId,
            this.provider.id
          )
        );
      }
    }

    return {
      id: row.id,
      invoiceId: row.invoiceId,
      companyId: row.companyId,
      customerId: row.customerId,
      customerExternalId,
      customerName: row.customerName ?? null,
      status: row.status,
      currencyCode: row.currencyCode,
      exchangeRate: Number(row.exchangeRate) || 1,
      dateIssued: row.dateIssued,
      dateDue: row.dateDue,
      datePaid: row.datePaid,
      customerReference: row.customerReference,
      subtotal: Number(row.subtotal) || 0,
      totalTax: Number(row.totalTax) || 0,
      totalDiscount: Number(row.totalDiscount) || 0,
      totalAmount: Number(row.totalAmount) || 0,
      balance: Number(row.balance) || 0,
      lines: (lineRows as InvoiceLineRow[]).map((line) => ({
        id: line.id,
        invoiceLineType: line.invoiceLineType,
        itemId: line.itemId,
        itemCode: line.itemReadableIdWithRevision,
        itemExternalId: line.itemId
          ? (itemExternalIds.get(line.itemId) ?? null)
          : null,
        description: line.description,
        quantity: Number(line.quantity) || 0,
        unitPrice: Number(line.unitPrice) || 0,
        taxPercent: Number(line.taxPercent) || 0,
        lineAmount: roundCurrency(
          (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)
        )
      })),
      updatedAt: row.updatedAt ?? new Date().toISOString(),
      raw: row
    };
  }
}
