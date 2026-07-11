import { roundCurrency } from "../../../core/posting";
import type { Accounting } from "../../../core/types";
import type { QbdPurchaseOrderInput } from "../qbxml/entities/purchase-order";
import * as purchaseOrder from "../qbxml/entities/purchase-order";
import type { QbxmlResponse } from "../qbxml/parse";
import {
  type QbdBuildRequestResult,
  QbdEntitySyncer,
  type QbdOperationInput,
  type QbdProcessResponseResult
} from "./shared";

/**
 * QbdPurchaseOrderSyncer — locked Carbon purchase orders → QuickBooks
 * Desktop PurchaseOrder transactions (push-only v1, Add-only). Transaction
 * flow per entities/shared.ts: mapping exists → idempotent completion;
 * otherwise Add directly. VendorRef/line ItemRefs resolve mapping-first
 * with name/code FullName fallbacks. Carbon deliveryDate → ExpectedDate.
 */

// Only sync POs in locked statuses (Xero/QBO parity)
const SYNCABLE_STATUSES: Accounting.PurchaseOrder["status"][] = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed"
];

/**
 * Local shape for the QBD purchase-order push: shared PO fields plus the
 * vendor name (FullName fallback) and per-line item ListIDs.
 */
export type QbdPurchaseOrderLocal = Omit<Accounting.PurchaseOrder, "lines"> & {
  supplierName: string | null;
  lines: Array<
    Accounting.PurchaseOrderLine & { itemExternalId: string | null }
  >;
};

type PurchaseOrderRow = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  supplierId: string;
  status: Accounting.PurchaseOrder["status"];
  orderDate: string | null;
  currencyCode: string | null;
  exchangeRate: number | null;
  supplierReference: string | null;
  updatedAt: string | null;
  supplierName: string | null;
};

type PurchaseOrderLineRow = {
  id: string;
  description: string | null;
  purchaseQuantity: number | null;
  unitPrice: number | null;
  itemId: string | null;
  accountId: string | null;
  taxPercent: number | null;
  taxAmount: number | null;
  extendedPrice: number | null;
  quantityReceived: number | null;
  quantityInvoiced: number | null;
  itemCode: string | null;
  accountNumber: string | null;
};

/**
 * Map a Carbon purchase order to the QBD PurchaseOrderAdd input. Pure —
 * exported for tests. TxnDate = orderDate falling back to the row's
 * updatedAt date; deliveryDate → ExpectedDate; readableId = the PO number.
 */
export function toQbdPurchaseOrderInput(
  local: QbdPurchaseOrderLocal
): QbdPurchaseOrderInput {
  return {
    vendorRef: {
      listId: local.supplierExternalId ?? null,
      fullName: local.supplierName ?? null
    },
    txnDate: (local.orderDate ?? local.updatedAt).slice(0, 10),
    expectedDate: local.deliveryDate ?? null,
    readableId: local.purchaseOrderId,
    entityId: local.id,
    lines: local.lines.map((line) => ({
      itemRef: line.itemId
        ? { listId: line.itemExternalId, fullName: line.itemCode ?? null }
        : null,
      description: line.description ?? null,
      quantity: line.quantity,
      rate: line.unitPrice,
      amount: roundCurrency(line.totalAmount)
    }))
  };
}

export class QbdPurchaseOrderSyncer extends QbdEntitySyncer<QbdPurchaseOrderLocal> {
  async buildRequest(op: QbdOperationInput): Promise<QbdBuildRequestResult> {
    return this.runBuild(async () => {
      const mapping = await this.getMapping(op.entityId);
      if (mapping?.externalId) {
        return {
          outcome: "completed",
          reason:
            "Purchase order already pushed to QuickBooks Desktop — skipping (idempotent)",
          externalId: mapping.externalId
        };
      }

      const local = await this.fetchLocal(op.entityId);
      if (!local) {
        throw new Error(`Purchase order ${op.entityId} not found in Carbon`);
      }

      if (!SYNCABLE_STATUSES.includes(local.status)) {
        return {
          outcome: "completed",
          reason: `Purchase order must be released before syncing (current status: ${local.status})`
        };
      }

      return {
        outcome: "request",
        requestXml: purchaseOrder.buildAddRq({
          requestID: op.id,
          purchaseOrder: toQbdPurchaseOrderInput(local)
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
      parseRet: purchaseOrder.parseRet,
      entityLabel: "purchase order"
    });
  }

  async fetchLocal(id: string): Promise<QbdPurchaseOrderLocal | null> {
    const orderRows = await this.database
      .selectFrom("purchaseOrder")
      .leftJoin("supplier", "supplier.id", "purchaseOrder.supplierId")
      .select([
        "purchaseOrder.id",
        "purchaseOrder.companyId",
        "purchaseOrder.purchaseOrderId",
        "purchaseOrder.supplierId",
        "purchaseOrder.status",
        "purchaseOrder.orderDate",
        "purchaseOrder.currencyCode",
        "purchaseOrder.exchangeRate",
        "purchaseOrder.supplierReference",
        "purchaseOrder.updatedAt",
        "supplier.name as supplierName"
      ])
      .where("purchaseOrder.id", "=", id)
      .where("purchaseOrder.companyId", "=", this.companyId)
      .execute();

    const row = (orderRows as PurchaseOrderRow[])[0];
    if (!row) return null;

    const lineRows = await this.database
      .selectFrom("purchaseOrderLine")
      .leftJoin("item", "item.id", "purchaseOrderLine.itemId")
      .leftJoin("account", "account.id", "purchaseOrderLine.accountId")
      .select([
        "purchaseOrderLine.id",
        "purchaseOrderLine.description",
        "purchaseOrderLine.purchaseQuantity",
        "purchaseOrderLine.unitPrice",
        "purchaseOrderLine.itemId",
        "purchaseOrderLine.accountId",
        "purchaseOrderLine.taxPercent",
        "purchaseOrderLine.taxAmount",
        "purchaseOrderLine.extendedPrice",
        "purchaseOrderLine.quantityReceived",
        "purchaseOrderLine.quantityInvoiced",
        "item.readableId as itemCode",
        "account.number as accountNumber"
      ])
      .where("purchaseOrderLine.purchaseOrderId", "=", id)
      .where("purchaseOrderLine.companyId", "=", this.companyId)
      .execute();

    // Dependency ListIDs from the mappings (vendor + per-line items)
    const supplierExternalId = await this.mappingService.getExternalId(
      "vendor",
      row.supplierId,
      this.provider.id
    );

    const itemExternalIds = new Map<string, string | null>();
    for (const line of lineRows as PurchaseOrderLineRow[]) {
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

    let subtotal = 0;
    let totalTax = 0;
    for (const line of lineRows as PurchaseOrderLineRow[]) {
      subtotal += Number(line.extendedPrice) || 0;
      totalTax += Number(line.taxAmount) || 0;
    }

    return {
      id: row.id,
      companyId: row.companyId,
      purchaseOrderId: row.purchaseOrderId,
      supplierId: row.supplierId,
      supplierExternalId,
      supplierName: row.supplierName ?? null,
      status: row.status,
      orderDate: row.orderDate,
      deliveryDate: null, // would need to join purchaseOrderDelivery (Xero-syncer parity)
      deliveryAddress: null,
      deliveryInstructions: null,
      currencyCode: row.currencyCode,
      exchangeRate: row.exchangeRate,
      subtotal: roundCurrency(subtotal),
      totalTax: roundCurrency(totalTax),
      totalAmount: roundCurrency(subtotal + totalTax),
      supplierReference: row.supplierReference,
      lines: (lineRows as PurchaseOrderLineRow[]).map((line) => ({
        id: line.id,
        description: line.description,
        quantity: Number(line.purchaseQuantity) || 0,
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
        totalAmount: Number(line.extendedPrice) || 0,
        quantityReceived: line.quantityReceived,
        quantityInvoiced: line.quantityInvoiced
      })),
      updatedAt: row.updatedAt ?? new Date().toISOString(),
      raw: row
    };
  }
}
