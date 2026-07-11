import { roundCurrency } from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type { QbdBillInput } from "../qbxml/entities/bill";
import * as bill from "../qbxml/entities/bill";
import type { QbxmlResponse } from "../qbxml/parse";
import {
  loadQbdAccountListIdsById,
  type QbdBuildRequestResult,
  QbdEntitySyncer,
  type QbdOperationInput,
  type QbdProcessResponseResult
} from "./shared";

/**
 * QbdBillSyncer — Carbon purchase invoices → QuickBooks Desktop Bill
 * transactions (push-only v1, Add-only). Transaction flow per
 * entities/shared.ts: mapping exists → idempotent completion; otherwise
 * Add directly.
 *
 * Line mapping: lines WITH an item become ItemLineAdd (ItemRef
 * mapping-first, item-code FullName fallback); lines WITHOUT an item
 * become ExpenseLineAdd with the line's G/L account resolved through the
 * account mapping — an unmapped (or missing) account fails
 * UNMAPPED_ACCOUNTS (Warning) via the D4 builder. No status gate (QBO
 * parity: the bill syncer pushes whatever the enqueue side decided to
 * sync).
 */

/**
 * Local shape for the QBD bill push: shared bill fields plus the vendor
 * name (VendorRef FullName fallback) and per-line item ListIDs.
 */
export type QbdBillLocal = Omit<Accounting.Bill, "lines"> & {
  supplierName: string | null;
  lines: Array<Accounting.BillLine & { itemExternalId: string | null }>;
};

type BillRow = {
  id: string;
  companyId: string;
  invoiceId: string;
  supplierId: string | null;
  status: Accounting.Bill["status"];
  dateIssued: string | null;
  dateDue: string | null;
  datePaid: string | null;
  currencyCode: string;
  exchangeRate: number;
  subtotal: number;
  totalTax: number;
  totalDiscount: number;
  totalAmount: number;
  balance: number | null;
  supplierReference: string | null;
  updatedAt: string | null;
  supplierName: string | null;
};

type BillLineRow = {
  id: string;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  itemId: string | null;
  accountId: string | null;
  taxPercent: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  purchaseOrderLineId: string | null;
  itemCode: string | null;
  accountNumber: string | null;
};

/**
 * Map a Carbon bill to the QBD BillAdd input. Pure — exported for tests.
 * Item lines → ItemLineAdd (cost = unitPrice, amount = the line total);
 * non-item lines → ExpenseLineAdd with the mapped account ListID (null →
 * the builder throws UNMAPPED_ACCOUNTS). TxnDate = dateIssued falling back
 * to the row's updatedAt date.
 */
export function toQbdBillInput(
  local: QbdBillLocal,
  accountListIdsById: ReadonlyMap<string, string>
): QbdBillInput {
  const itemLines = local.lines
    .filter((line) => line.itemId)
    .map((line) => ({
      itemRef: { listId: line.itemExternalId, fullName: line.itemCode ?? null },
      description: line.description ?? null,
      quantity: line.quantity,
      cost: line.unitPrice ?? null,
      amount: roundCurrency(line.totalAmount)
    }));

  const expenseLines = local.lines
    .filter((line) => !line.itemId)
    .map((line) => ({
      accountRef: {
        listId: line.accountId
          ? (accountListIdsById.get(line.accountId) ?? null)
          : null
      },
      amount: roundCurrency(line.totalAmount),
      memo: line.description ?? null
    }));

  return {
    vendorRef: {
      listId: local.supplierExternalId ?? null,
      fullName: local.supplierName ?? null
    },
    txnDate: (local.dateIssued ?? local.updatedAt).slice(0, 10),
    dueDate: local.dateDue ?? null,
    readableId: local.invoiceId,
    entityId: local.id,
    expenseLines,
    itemLines
  };
}

export class QbdBillSyncer extends QbdEntitySyncer<QbdBillLocal> {
  private accountListIdsByIdPromise?: Promise<Map<string, string>>;

  private getAccountListIdsById(): Promise<Map<string, string>> {
    if (!this.accountListIdsByIdPromise) {
      this.accountListIdsByIdPromise = loadQbdAccountListIdsById(
        this.database,
        { companyId: this.companyId, integration: this.provider.id }
      );
    }
    return this.accountListIdsByIdPromise;
  }

  async buildRequest(op: QbdOperationInput): Promise<QbdBuildRequestResult> {
    return this.runBuild(async () => {
      const mapping = await this.getMapping(op.entityId);
      if (mapping?.externalId) {
        return {
          outcome: "completed",
          reason:
            "Bill already pushed to QuickBooks Desktop — skipping (idempotent)",
          externalId: mapping.externalId
        };
      }

      const local = await this.fetchLocal(op.entityId);
      if (!local) {
        throw new Error(`Purchase invoice ${op.entityId} not found in Carbon`);
      }

      const accountListIdsById = await this.getAccountListIdsById();

      return {
        outcome: "request",
        requestXml: bill.buildAddRq({
          requestID: op.id,
          bill: toQbdBillInput(local, accountListIdsById)
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
      parseRet: bill.parseRet,
      entityLabel: "bill"
    });
  }

  async fetchLocal(id: string): Promise<QbdBillLocal | null> {
    const billRows = await this.database
      .selectFrom("purchaseInvoice")
      // `balance` is derived and lives only on the `purchaseInvoices` view
      .leftJoin("purchaseInvoices", "purchaseInvoices.id", "purchaseInvoice.id")
      .leftJoin("supplier", "supplier.id", "purchaseInvoice.supplierId")
      .select([
        "purchaseInvoice.id",
        "purchaseInvoice.companyId",
        "purchaseInvoice.invoiceId",
        "purchaseInvoice.supplierId",
        "purchaseInvoice.status",
        "purchaseInvoice.dateIssued",
        "purchaseInvoice.dateDue",
        "purchaseInvoice.datePaid",
        "purchaseInvoice.currencyCode",
        "purchaseInvoice.exchangeRate",
        "purchaseInvoice.subtotal",
        "purchaseInvoice.totalTax",
        "purchaseInvoice.totalDiscount",
        "purchaseInvoice.totalAmount",
        "purchaseInvoices.balance",
        "purchaseInvoice.supplierReference",
        "purchaseInvoice.updatedAt",
        "supplier.name as supplierName"
      ])
      .where("purchaseInvoice.id", "=", id)
      .where("purchaseInvoice.companyId", "=", this.companyId)
      .execute();

    const row = (billRows as BillRow[])[0];
    if (!row) return null;

    const lineRows = await this.database
      .selectFrom("purchaseInvoiceLine")
      .leftJoin("item", "item.id", "purchaseInvoiceLine.itemId")
      .leftJoin("account", "account.id", "purchaseInvoiceLine.accountId")
      .select([
        "purchaseInvoiceLine.id",
        "purchaseInvoiceLine.description",
        "purchaseInvoiceLine.quantity",
        "purchaseInvoiceLine.unitPrice",
        "purchaseInvoiceLine.itemId",
        "purchaseInvoiceLine.accountId",
        "purchaseInvoiceLine.taxPercent",
        "purchaseInvoiceLine.taxAmount",
        "purchaseInvoiceLine.totalAmount",
        "purchaseInvoiceLine.purchaseOrderLineId",
        "item.readableId as itemCode",
        "account.number as accountNumber"
      ])
      .where("purchaseInvoiceLine.invoiceId", "=", id)
      .where("purchaseInvoiceLine.companyId", "=", this.companyId)
      .execute();

    // Dependency ListIDs from the mappings (vendor + per-line items)
    const supplierExternalId = row.supplierId
      ? await this.mappingService.getExternalId(
          "vendor",
          row.supplierId,
          this.provider.id
        )
      : null;

    const itemExternalIds = new Map<string, string | null>();
    for (const line of lineRows as BillLineRow[]) {
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
      companyId: row.companyId,
      invoiceId: row.invoiceId,
      supplierId: row.supplierId,
      supplierExternalId,
      supplierName: row.supplierName ?? null,
      status: row.status,
      dateIssued: row.dateIssued,
      dateDue: row.dateDue,
      datePaid: row.datePaid,
      currencyCode: row.currencyCode,
      exchangeRate: Number(row.exchangeRate) || 1,
      subtotal: Number(row.subtotal) || 0,
      totalTax: Number(row.totalTax) || 0,
      totalDiscount: Number(row.totalDiscount) || 0,
      totalAmount: Number(row.totalAmount) || 0,
      balance: Number(row.balance) || 0,
      supplierReference: row.supplierReference,
      lines: (lineRows as BillLineRow[]).map((line) => ({
        id: line.id,
        description: line.description,
        quantity: Number(line.quantity) || 0,
        unitPrice: Number(line.unitPrice) || 0,
        itemId: line.itemId,
        itemCode: line.itemCode,
        itemExternalId: line.itemId
          ? (itemExternalIds.get(line.itemId) ?? null)
          : null,
        accountId: line.accountId,
        accountNumber: line.accountNumber,
        taxPercent: line.taxPercent,
        taxAmount: line.taxAmount,
        totalAmount: Number(line.totalAmount) || 0,
        purchaseOrderLineId: line.purchaseOrderLineId
      })),
      updatedAt: row.updatedAt ?? new Date().toISOString(),
      raw: row
    };
  }
}
