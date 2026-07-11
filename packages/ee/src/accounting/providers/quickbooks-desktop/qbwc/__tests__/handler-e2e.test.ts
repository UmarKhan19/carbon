import { describe, expect, it } from "vitest";
import {
  DEFAULT_POSTING_SYNC_SETTINGS,
  type PostingSyncSettings
} from "../../../../core/posting";
import type { Accounting, SyncContext } from "../../../../core/types";
import { QbdCustomerSyncer } from "../../entities/customer";
import {
  type QbdSalesInvoiceLocal,
  QbdSalesInvoiceSyncer
} from "../../entities/invoice";
import { QbdJournalEntrySyncer } from "../../entities/journal-entry";
import { hashPassword } from "../credentials";
import {
  handleQbwcRequest,
  type QbwcHandlerContext,
  type QbwcPolledSyncer
} from "../handler";
import { FakeCarbonStore } from "./fake-client";

/**
 * D13 scripted protocol e2e: the FULL QBWC conversation (authenticate →
 * sendRequestXML → receiveResponseXML → … → closeConnection) through
 * handleQbwcRequest, against the in-memory PostgREST fake AND the REAL
 * entity syncers — real qbXML builders, real list/transaction flows, real
 * response parsing. Unlike handler-loop.test.ts (scripted syncer stubs),
 * only the database-touching members are overridden (fetchLocal,
 * mappingService, persistLink, the journal syncer's cached loaders) —
 * exactly the __tests__/syncers.test.ts pattern — with mapping links kept
 * in a live in-memory store so idempotency is observable across calls.
 *
 * The scenario (plan Task D13): a company with an active
 * quickbooks-desktop integration (webConnector credentials, real scrypt
 * hash), mapped accounts, and 3 Pending operations — a customer, a posted
 * sales invoice, and a Posted journal with balanced lines. The customer is
 * new to QuickBooks, so its list flow walks query(miss) → add while the
 * two transactions Add directly:
 *
 *   authenticate            → [ticket, ""]
 *   sendRequestXML #1       → CustomerQueryRq + InvoiceAddRq + JournalEntryAddRq
 *   receiveResponseXML #1   ← query miss + 2 × Add ok        → 66
 *   sendRequestXML #2       → CustomerAddRq (the follow-up)
 *   receiveResponseXML #2   ← CustomerAddRs ok               → 100
 *   closeConnection         → "Sync complete"
 *
 * Then a SECOND identical conversation authenticates and gets "none":
 * every operation is Completed and mapped, so zero new requests are ever
 * built (the idempotency gate).
 */

const COMPANY_ID = "company-1";
const INTEGRATION = "quickbooks-desktop";
const USERNAME = `carbon-${COMPANY_ID}`;
const PASSWORD = "correct-horse-battery";
const PASSWORD_HASH = hashPassword(PASSWORD);

// /********************************************************\
// *                     SOAP plumbing                       *
// \********************************************************/

function soapEnvelope(
  operation: string,
  params: Record<string, string> = {}
): string {
  const paramXml = Object.entries(params)
    .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${operation} xmlns="http://developer.intuit.com/">${paramXml}</${operation}></soap:Body></soap:Envelope>`
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function scalarResult(operation: string, soapXml: string): string {
  const match = new RegExp(
    `<${operation}Result>([\\s\\S]*?)</${operation}Result>`
  ).exec(soapXml);
  return match?.[1] ?? "";
}

function stringArrayResult(soapXml: string): string[] {
  return [...soapXml.matchAll(/<string>(.*?)<\/string>/g)].map(
    (match) => match[1] ?? ""
  );
}

function messageSetId(qbxml: string, attribute: "new" | "old"): string {
  const match = new RegExp(`${attribute}MessageSetID="([^"]+)"`).exec(qbxml);
  return match?.[1] ?? "";
}

async function authenticate(ctx: QbwcHandlerContext): Promise<string[]> {
  const { soapXml } = await handleQbwcRequest(
    soapEnvelope("authenticate", {
      strUserName: USERNAME,
      strPassword: PASSWORD
    }),
    ctx
  );
  return stringArrayResult(soapXml);
}

/** Returns the (unescaped) qbXML handed to QBWC, "" when there is none. */
async function sendRequest(
  ctx: QbwcHandlerContext,
  ticket: string
): Promise<string> {
  const { soapXml } = await handleQbwcRequest(
    soapEnvelope("sendRequestXML", {
      ticket,
      strHCPResponse: "",
      strCompanyFileName: "C:\\QB\\acme.qbw",
      qbXMLCountry: "US",
      qbXMLMajorVers: "16",
      qbXMLMinorVers: "0"
    }),
    ctx
  );
  return unescapeXml(scalarResult("sendRequestXML", soapXml));
}

/** Returns the percent-done int QBWC receives. */
async function receiveResponse(
  ctx: QbwcHandlerContext,
  ticket: string,
  response: string
): Promise<number> {
  const { soapXml } = await handleQbwcRequest(
    soapEnvelope("receiveResponseXML", {
      ticket,
      response,
      hresult: "",
      message: ""
    }),
    ctx
  );
  return Number(scalarResult("receiveResponseXML", soapXml));
}

async function closeConnection(
  ctx: QbwcHandlerContext,
  ticket: string
): Promise<string> {
  const { soapXml } = await handleQbwcRequest(
    soapEnvelope("closeConnection", { ticket }),
    ctx
  );
  return scalarResult("closeConnection", soapXml);
}

// /********************************************************\
// *        In-memory external-integration mappings          *
// \********************************************************/

type StoredMapping = {
  externalId: string;
  metadata: Record<string, unknown> | null;
};

/**
 * Stand-in for the externalIntegrationMapping table: persistLink writes
 * land here and every later getByEntity (idempotency checks, list-phase
 * resolution) reads them back — the cross-call linkage the real service
 * provides via the database.
 */
class FakeMappingStore {
  readonly records = new Map<string, StoredMapping>();

  private key(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  get(entityType: string, entityId: string): StoredMapping | null {
    return this.records.get(this.key(entityType, entityId)) ?? null;
  }

  link(
    entityType: string,
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): void {
    this.records.set(this.key(entityType, entityId), {
      externalId,
      metadata: editSequence !== null ? { editSequence } : null
    });
  }
}

// /********************************************************\
// *      Real syncers with only the DB members faked        *
// \********************************************************/

type E2eFixtures = {
  customers: Map<string, Accounting.Contact>;
  invoices: Map<string, QbdSalesInvoiceLocal>;
  journals: Map<string, Accounting.JournalEntry>;
  /** Seeded account mappings: Carbon account.id → QB account ListID. */
  accountListIds: Map<string, string>;
  controlAccountIds: Set<string>;
  postingSettings: PostingSyncSettings;
  mappings: FakeMappingStore;
};

function mappingServiceStub(mappings: FakeMappingStore) {
  return {
    getByEntity: async (entityType: string, entityId: string) =>
      mappings.get(entityType, entityId),
    getExternalId: async (entityType: string, entityId: string) =>
      mappings.get(entityType, entityId)?.externalId ?? null
  };
}

class E2eCustomerSyncer extends QbdCustomerSyncer {
  constructor(
    context: SyncContext,
    private fixtures: E2eFixtures
  ) {
    super(context);
    (this as any).mappingService = mappingServiceStub(fixtures.mappings);
  }

  async fetchLocal(id: string): Promise<Accounting.Contact | null> {
    return this.fixtures.customers.get(id) ?? null;
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.fixtures.mappings.link(
      this.entityType,
      entityId,
      externalId,
      editSequence
    );
  }
}

class E2eInvoiceSyncer extends QbdSalesInvoiceSyncer {
  constructor(
    context: SyncContext,
    private fixtures: E2eFixtures
  ) {
    super(context);
    (this as any).mappingService = mappingServiceStub(fixtures.mappings);
  }

  async fetchLocal(id: string): Promise<QbdSalesInvoiceLocal | null> {
    return this.fixtures.invoices.get(id) ?? null;
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.fixtures.mappings.link(
      this.entityType,
      entityId,
      externalId,
      editSequence
    );
  }
}

class E2eJournalSyncer extends QbdJournalEntrySyncer {
  constructor(
    context: SyncContext,
    private fixtures: E2eFixtures
  ) {
    super(context);
    (this as any).mappingService = mappingServiceStub(fixtures.mappings);
  }

  async fetchLocal(id: string): Promise<Accounting.JournalEntry | null> {
    return this.fixtures.journals.get(id) ?? null;
  }

  getPostingSyncSettings(): Promise<PostingSyncSettings> {
    return Promise.resolve(this.fixtures.postingSettings);
  }

  getAccountListIdsById(): Promise<Map<string, string>> {
    return Promise.resolve(this.fixtures.accountListIds);
  }

  getControlAccountIds(): Promise<Set<string>> {
    return Promise.resolve(this.fixtures.controlAccountIds);
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.fixtures.mappings.link(
      this.entityType,
      entityId,
      externalId,
      editSequence
    );
  }
}

// /********************************************************\
// *                    Local fixtures                       *
// \********************************************************/

const customerFixture: Accounting.Contact = {
  id: "cust-1",
  name: "Acme Manufacturing",
  firstName: "Jane",
  lastName: "Doe",
  companyId: COMPANY_ID,
  email: "jane@acme.example",
  website: null,
  taxId: null,
  currencyCode: "USD",
  balance: null,
  creditLimit: null,
  paymentTerms: null,
  updatedAt: "2026-07-01T12:00:00.000Z",
  workPhone: "555-0100",
  mobilePhone: null,
  fax: null,
  homePhone: null,
  isVendor: false,
  isCustomer: true,
  addresses: [
    {
      label: "HQ",
      type: null,
      line1: "1 Factory Way",
      line2: "Suite 2",
      city: "Cleveland",
      country: "US",
      region: "OH",
      postalCode: "44101"
    }
  ],
  raw: {}
};

// The customer is being pushed in the SAME batch, so the invoice's
// CustomerRef uses the FullName fallback (no mapping yet — the polled
// transport has no JIT dependency push). The item was mapped previously.
const invoiceFixture: QbdSalesInvoiceLocal = {
  id: "slsinv_1",
  invoiceId: "SI000042",
  companyId: COMPANY_ID,
  customerId: "cust-1",
  customerExternalId: null,
  customerName: "Acme Manufacturing",
  status: "Submitted",
  currencyCode: "USD",
  exchangeRate: 1,
  dateIssued: "2026-07-01",
  dateDue: "2026-07-31",
  datePaid: null,
  customerReference: null,
  subtotal: 500,
  totalTax: 0,
  totalDiscount: 0,
  totalAmount: 500,
  balance: 500,
  lines: [
    {
      id: "line-1",
      invoiceLineType: "Part",
      itemId: "item-1",
      itemCode: "PART-001",
      itemExternalId: "QB-ITEM-1",
      description: "Widget",
      quantity: 2,
      unitPrice: 250,
      taxPercent: 0,
      lineAmount: 500
    }
  ],
  updatedAt: "2026-07-01T12:00:00.000Z",
  raw: {}
};

// Posted, balanced (+500 inventory / -500 GRNI), non-document-backed
// sourceType so the posting-sync gates let it through.
const journalFixture: Accounting.JournalEntry = {
  id: "je_1",
  companyId: COMPANY_ID,
  journalEntryId: "JE000123",
  description: null,
  postingDate: "2026-07-03",
  status: "Posted",
  sourceType: "Purchase Receipt",
  reversalOfId: null,
  reversedById: null,
  reversal: false,
  lines: [
    { id: "jl-1", accountId: "acct-inventory", amount: 500, description: null },
    { id: "jl-2", accountId: "acct-grni", amount: -500, description: null }
  ],
  updatedAt: "2026-07-03T12:00:00.000Z"
};

// /********************************************************\
// *                        Harness                          *
// \********************************************************/

function makeE2eHarness() {
  const store = new FakeCarbonStore();
  store.seed("companyIntegration", {
    id: INTEGRATION,
    companyId: COMPANY_ID,
    active: true,
    updatedBy: "user-1",
    updatedAt: new Date().toISOString(),
    metadata: {
      credentials: {
        type: "webConnector",
        username: USERNAME,
        passwordHash: PASSWORD_HASH,
        ownerId: "{C1885F59-B650-49EE-93B7-CDDC31482121}",
        fileId: "{9AF40000-0000-0000-0000-000000000001}"
      }
    }
  });

  const fixtures: E2eFixtures = {
    customers: new Map([[customerFixture.id, customerFixture]]),
    invoices: new Map([[invoiceFixture.id, invoiceFixture]]),
    journals: new Map([[journalFixture.id, journalFixture]]),
    // Mapped accounts (account-mapping rows: accountId → QB ListID)
    accountListIds: new Map([
      ["acct-inventory", "QB-ACCT-INV"],
      ["acct-grni", "QB-ACCT-GRNI"]
    ]),
    // AR/AP control accounts — not referenced by the journal, so the
    // control-account guard evaluates and passes
    controlAccountIds: new Set(["acct-ar", "acct-ap"]),
    postingSettings: { ...DEFAULT_POSTING_SYNC_SETTINGS, enabled: true },
    mappings: new FakeMappingStore()
  };

  const buildCalls: string[] = [];
  const processCalls: string[] = [];

  const ctx: QbwcHandlerContext = {
    client: store.client(),
    database: {} as SyncContext["database"],
    now: () => new Date(),
    // REAL syncers (constructed with the handler's own SyncContext — the
    // provider is the real QbdProvider loadProvider builds from the seeded
    // integration row); the wrapper only records calls for the
    // zero-new-requests assertions.
    getSyncer: (context): QbwcPolledSyncer => {
      const syncer = makeSyncer(context, fixtures);
      return {
        buildRequest(op) {
          buildCalls.push(`${context.entityType}:${op.id}`);
          return syncer.buildRequest(op);
        },
        processResponse(op, response) {
          processCalls.push(`${context.entityType}:${op.id}`);
          return syncer.processResponse(op, response);
        }
      };
    }
  };

  return { store, fixtures, ctx, buildCalls, processCalls };
}

function makeSyncer(
  context: SyncContext,
  fixtures: E2eFixtures
): QbwcPolledSyncer {
  switch (context.entityType) {
    case "customer":
      return new E2eCustomerSyncer(context, fixtures);
    case "invoice":
      return new E2eInvoiceSyncer(context, fixtures);
    case "journalEntry":
      return new E2eJournalSyncer(context, fixtures);
    default:
      throw new Error(
        `e2e harness has no syncer for entity type "${context.entityType}"`
      );
  }
}

function seedPendingOperation(
  store: FakeCarbonStore,
  args: { id: string; entityType: string; entityId: string; createdAt: string }
) {
  return store.seed("accountingSyncOperation", {
    id: args.id,
    companyId: COMPANY_ID,
    integration: INTEGRATION,
    entityType: args.entityType,
    entityId: args.entityId,
    direction: "push-to-accounting",
    trigger: "event",
    status: "Pending",
    idempotencyKey: `key-${args.id}`,
    createdAt: args.createdAt
  });
}

// /********************************************************\
// *              Golden qbXML (requests we send)            *
// \********************************************************/

const CUSTOMER_QUERY_RQ =
  '<CustomerQueryRq requestID="op-customer">' +
  "<FullName>Acme Manufacturing</FullName>" +
  "</CustomerQueryRq>";

const CUSTOMER_ADD_RQ =
  '<CustomerAddRq requestID="op-customer"><CustomerAdd>' +
  "<Name>Acme Manufacturing</Name>" +
  "<BillAddress><Addr1>1 Factory Way</Addr1><Addr2>Suite 2</Addr2><City>Cleveland</City><State>OH</State><PostalCode>44101</PostalCode><Country>US</Country></BillAddress>" +
  "<Phone>555-0100</Phone>" +
  "<Email>jane@acme.example</Email>" +
  "</CustomerAdd></CustomerAddRq>";

const INVOICE_ADD_RQ =
  '<InvoiceAddRq requestID="op-invoice"><InvoiceAdd>' +
  "<CustomerRef><FullName>Acme Manufacturing</FullName></CustomerRef>" +
  "<TxnDate>2026-07-01</TxnDate>" +
  "<RefNumber>SI000042</RefNumber>" +
  "<DueDate>2026-07-31</DueDate>" +
  "<Memo>Carbon SI000042 slsinv_1</Memo>" +
  "<InvoiceLineAdd><ItemRef><ListID>QB-ITEM-1</ListID></ItemRef><Desc>Widget</Desc><Quantity>2</Quantity><Rate>250.00</Rate><Amount>500.00</Amount></InvoiceLineAdd>" +
  "</InvoiceAdd></InvoiceAddRq>";

const JOURNAL_ADD_RQ =
  '<JournalEntryAddRq requestID="op-journal"><JournalEntryAdd>' +
  "<TxnDate>2026-07-03</TxnDate>" +
  "<RefNumber>JE000123</RefNumber>" +
  "<JournalDebitLine><AccountRef><ListID>QB-ACCT-INV</ListID></AccountRef><Amount>500.00</Amount><Memo>Carbon JE000123 je_1</Memo></JournalDebitLine>" +
  "<JournalCreditLine><AccountRef><ListID>QB-ACCT-GRNI</ListID></AccountRef><Amount>500.00</Amount><Memo>Carbon JE000123 je_1</Memo></JournalCreditLine>" +
  "</JournalEntryAdd></JournalEntryAddRq>";

function messageSet(newMessageSetId: string, requests: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<?qbxml version="16.0"?>\n' +
    `<QBXML><QBXMLMsgsRq onError="continueOnError" newMessageSetID="${newMessageSetId}">` +
    requests +
    "</QBXMLMsgsRq></QBXML>"
  );
}

// /********************************************************\
// *           Golden qbXML (responses QB returns)           *
// \********************************************************/

const BATCH_1_RESPONSES =
  '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
  // The customer does not exist in QuickBooks yet — query miss
  '<CustomerQueryRs requestID="op-customer" statusCode="1" statusSeverity="Warn" statusMessage="A query request did not find a matching object in QuickBooks" />' +
  '<InvoiceAddRs requestID="op-invoice" statusCode="0" statusSeverity="Info" statusMessage="Status OK">' +
  "<InvoiceRet><TxnID>5D21-1622994339</TxnID><EditSequence>1622994339</EditSequence><RefNumber>SI000042</RefNumber><Memo>Carbon SI000042 slsinv_1</Memo></InvoiceRet>" +
  "</InvoiceAddRs>" +
  '<JournalEntryAddRs requestID="op-journal" statusCode="0" statusSeverity="Info" statusMessage="Status OK">' +
  "<JournalEntryRet><TxnID>7A15-1622990001</TxnID><EditSequence>1622990001</EditSequence><RefNumber>JE000123</RefNumber></JournalEntryRet>" +
  "</JournalEntryAddRs>" +
  "</QBXMLMsgsRs></QBXML>";

const BATCH_2_RESPONSE =
  '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
  '<CustomerAddRs requestID="op-customer" statusCode="0" statusSeverity="Info" statusMessage="Status OK">' +
  "<CustomerRet><ListID>80000002-1751234567</ListID><EditSequence>1752000000</EditSequence><Name>Acme Manufacturing</Name><FullName>Acme Manufacturing</FullName></CustomerRet>" +
  "</CustomerAddRs></QBXMLMsgsRs></QBXML>";

// /********************************************************\
// *                         Test                            *
// \********************************************************/

describe("QBWC scripted protocol e2e (real syncers)", () => {
  it("drives the full conversation to completion, then a second conversation answers none", async () => {
    const { store, fixtures, ctx, buildCalls, processCalls } = makeE2eHarness();

    seedPendingOperation(store, {
      id: "op-customer",
      entityType: "customer",
      entityId: "cust-1",
      createdAt: "2026-07-11T10:00:00.000Z"
    });
    seedPendingOperation(store, {
      id: "op-invoice",
      entityType: "invoice",
      entityId: "slsinv_1",
      createdAt: "2026-07-11T10:00:01.000Z"
    });
    seedPendingOperation(store, {
      id: "op-journal",
      entityType: "journalEntry",
      entityId: "je_1",
      createdAt: "2026-07-11T10:00:02.000Z"
    });

    // ── Conversation 1: authenticate opens a session ────────────────
    const auth = await authenticate(ctx);
    expect(auth[1]).toBe("");
    const ticket = auth[0] ?? "";
    expect(ticket).toBeTruthy();
    expect(store.rows("qbwcSession")).toHaveLength(1);

    // ── sendRequestXML #1: all three requests, exact golden XML ─────
    const batch1 = await sendRequest(ctx, ticket);
    const setId1 = messageSetId(batch1, "new");
    expect(setId1).toBeTruthy();
    expect(batch1).toBe(
      messageSet(setId1, CUSTOMER_QUERY_RQ + INVOICE_ADD_RQ + JOURNAL_ADD_RQ)
    );

    // Phases persisted BEFORE the send (crash-recovery contract)
    expect(
      store.find("accountingSyncOperation", "op-customer")?.metadata
    ).toEqual({ qbdPhase: "query" });
    expect(
      store.find("accountingSyncOperation", "op-invoice")?.metadata
    ).toEqual({ qbdPhase: "add" });
    expect(
      store.find("accountingSyncOperation", "op-journal")?.metadata
    ).toEqual({ qbdPhase: "add" });

    // ── receiveResponseXML #1: 2 completed, customer follows up ─────
    const percent1 = await receiveResponse(ctx, ticket, BATCH_1_RESPONSES);
    expect(percent1).toBe(66); // floor(2 resolved / 3 known * 100)

    expect(store.find("accountingSyncOperation", "op-invoice")).toMatchObject({
      status: "Completed",
      externalId: "5D21-1622994339"
    });
    expect(store.find("accountingSyncOperation", "op-journal")).toMatchObject({
      status: "Completed",
      externalId: "7A15-1622990001"
    });
    // The query miss advances the customer to the add phase; it stays In
    // Flight, pinned to this session's batch
    expect(store.find("accountingSyncOperation", "op-customer")).toMatchObject({
      status: "In Flight",
      metadata: { qbdPhase: "add" }
    });
    expect(store.find("qbwcSession", ticket)?.claimedOperationIds).toEqual([
      "op-customer"
    ]);

    // Transaction mappings linked with TxnID + EditSequence
    expect(fixtures.mappings.get("invoice", "slsinv_1")).toEqual({
      externalId: "5D21-1622994339",
      metadata: { editSequence: "1622994339" }
    });
    expect(fixtures.mappings.get("journalEntry", "je_1")).toEqual({
      externalId: "7A15-1622990001",
      metadata: { editSequence: "1622990001" }
    });
    // The query missed — nothing linked for the customer yet
    expect(fixtures.mappings.get("customer", "cust-1")).toBeNull();

    // ── sendRequestXML #2: the customer Add, fresh message set ──────
    const batch2 = await sendRequest(ctx, ticket);
    const setId2 = messageSetId(batch2, "new");
    expect(setId2).toBeTruthy();
    expect(setId2).not.toBe(setId1);
    expect(batch2).toBe(messageSet(setId2, CUSTOMER_ADD_RQ));

    // ── receiveResponseXML #2: everything resolved → 100 ────────────
    const percent2 = await receiveResponse(ctx, ticket, BATCH_2_RESPONSE);
    expect(percent2).toBe(100);
    expect([percent1, percent2]).toEqual([66, 100]);

    expect(store.find("accountingSyncOperation", "op-customer")).toMatchObject({
      status: "Completed",
      externalId: "80000002-1751234567"
    });
    expect(fixtures.mappings.get("customer", "cust-1")).toEqual({
      externalId: "80000002-1751234567",
      metadata: { editSequence: "1752000000" }
    });
    expect(store.find("qbwcSession", ticket)?.claimedOperationIds).toBeNull();

    // ── closeConnection ─────────────────────────────────────────────
    expect(await closeConnection(ctx, ticket)).toBe("Sync complete");
    expect(store.find("qbwcSession", ticket)?.status).toBe("Closed");

    // Every request was built exactly once, in claim order
    expect(buildCalls).toEqual([
      "customer:op-customer",
      "invoice:op-invoice",
      "journalEntry:op-journal",
      "customer:op-customer" // the add follow-up after the query miss
    ]);
    expect(processCalls).toEqual([
      "customer:op-customer",
      "invoice:op-invoice",
      "journalEntry:op-journal",
      "customer:op-customer"
    ]);

    // ── Conversation 2: identical login → "none", zero new work ─────
    expect(await authenticate(ctx)).toEqual(["", "none"]);
    expect(store.rows("qbwcSession")).toHaveLength(1); // no new session
    expect(buildCalls).toHaveLength(4); // zero new requests built
    for (const id of ["op-customer", "op-invoice", "op-journal"]) {
      expect(store.find("accountingSyncOperation", id)?.status).toBe(
        "Completed"
      );
    }
  });
});
