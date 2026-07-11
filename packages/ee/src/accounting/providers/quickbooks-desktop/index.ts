import { ProviderID } from "../../core/models";
import { type SyncerRegistry, SyncFactory } from "../../core/sync";
import { QbdBillSyncer } from "./entities/bill";
import { QbdCustomerSyncer } from "./entities/customer";
import { QbdSalesInvoiceSyncer } from "./entities/invoice";
import { QbdItemSyncer } from "./entities/item";
import { QbdJournalEntrySyncer } from "./entities/journal-entry";
import { QbdPurchaseOrderSyncer } from "./entities/purchase-order";
import { QbdVendorSyncer } from "./entities/vendor";

export * from "./entities/bill";
export * from "./entities/customer";
export * from "./entities/invoice";
export * from "./entities/item";
export * from "./entities/journal-entry";
export * from "./entities/purchase-order";
// shared exports the two-phase polled-transport contract
// (QbdBuildRequestResult / QbdProcessResponseResult / QbdEntitySyncer)
export * from "./entities/shared";
export * from "./entities/vendor";
export * from "./provider";
// Web Connector connection plumbing consumed by the ERP settings UI
// (credential issuance + rotation, .qwc file generation, poll health).
export * from "./qbwc/credentials";
export * from "./qbwc/qwc-file";
export * from "./qbwc/session";
// The qbXML layer (./qbxml/**) is deliberately NOT star-exported: its
// entity modules each export buildAddRq/buildQueryRq/parseRet and would
// collide. The QBWC handler imports from ./qbxml/* directly, and the
// protocol handler modules (./qbwc/handler, ./qbwc/soap) stay unexported
// too — the SOAP resource route imports them by file path.

/**
 * Every syncer QuickBooks Desktop implements, keyed by entity type — ALL
 * push-only, drained by the Web Connector poll through each syncer's
 * buildRequest/processResponse halves (see entities/shared.ts). The
 * module-scope SyncFactory.register call below runs whenever this barrel
 * is imported — same contract as the Xero/QBO barrels.
 */
export const qbdSyncerRegistry: SyncerRegistry = {
  // Master Data (query-before-insert by FullName, then Add or Mod)
  customer: QbdCustomerSyncer,
  vendor: QbdVendorSyncer,
  item: QbdItemSyncer,

  // Transaction Data (Add-only; mapping existence = idempotent skip)
  bill: QbdBillSyncer,
  invoice: QbdSalesInvoiceSyncer,
  purchaseOrder: QbdPurchaseOrderSyncer,

  // Posting sync (push-only journal entries -> JournalEntryAdd)
  journalEntry: QbdJournalEntrySyncer

  // Not implemented in v1 (force-disabled in buildQbdSyncConfig):
  // - salesOrder / inventoryAdjustment / payment / employee
};

SyncFactory.register(ProviderID.QUICKBOOKS_DESKTOP, qbdSyncerRegistry);
