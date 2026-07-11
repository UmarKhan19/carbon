import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_CONFIG, ProviderID } from "../../../core/models";
import {
  DEFAULT_POSTING_SYNC_SETTINGS,
  type PostingSyncSettings
} from "../../../core/posting";
import type { Accounting, SyncContext } from "../../../core/types";
import {
  type QbdBillLocal,
  QbdBillSyncer,
  toQbdBillInput
} from "../entities/bill";
import { QbdCustomerSyncer } from "../entities/customer";
import {
  type QbdSalesInvoiceLocal,
  QbdSalesInvoiceSyncer
} from "../entities/invoice";
import { QbdItemSyncer } from "../entities/item";
import {
  buildQbdJournalEntryInput,
  QbdJournalEntrySyncer
} from "../entities/journal-entry";
import {
  type QbdPurchaseOrderLocal,
  QbdPurchaseOrderSyncer,
  toQbdPurchaseOrderInput
} from "../entities/purchase-order";
import {
  QBD_POLLED_TRANSPORT_ERROR,
  type QbdBuildRequestResult,
  type QbdOperationInput,
  type QbdProcessResponseResult,
  resolveQbdListPhase
} from "../entities/shared";
import { QbdVendorSyncer } from "../entities/vendor";
import { buildQbdSyncConfig, QbdProvider } from "../provider";
import { parseMessageSetResponse } from "../qbxml/parse";

// =====================================================================
// Harness — syncers constructed with a stubbed SyncContext; DB-touching
// members (fetchLocal, mappingService, persistLink, cached loaders) are
// overridden per test, mirroring the QBO entities test pattern.
// =====================================================================

type MappingStub = {
  externalId: string | null;
  metadata: Record<string, unknown> | null;
} | null;

function makeContext(entityType: SyncContext["entityType"]): SyncContext {
  return {
    database: {} as SyncContext["database"],
    companyId: "company-1",
    provider: {
      id: ProviderID.QUICKBOOKS_DESKTOP
    } as SyncContext["provider"],
    config: {
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    },
    entityType
  };
}

type LinkRecord = {
  entityId: string;
  externalId: string;
  editSequence: string | null;
};

function expectRequest(
  result: QbdBuildRequestResult
): Extract<QbdBuildRequestResult, { outcome: "request" }> {
  if (result.outcome !== "request") {
    throw new Error(`expected a request outcome, got ${result.outcome}`);
  }
  return result;
}

function expectCompleted(
  result: QbdBuildRequestResult
): Extract<QbdBuildRequestResult, { outcome: "completed" }> {
  if (result.outcome !== "completed") {
    throw new Error(`expected a completed outcome, got ${result.outcome}`);
  }
  return result;
}

function expectFailed(
  result: QbdBuildRequestResult | QbdProcessResponseResult
): Extract<QbdBuildRequestResult, { outcome: "failed" }> {
  if (result.outcome !== "failed") {
    throw new Error(`expected a failed outcome, got ${result.outcome}`);
  }
  return result as Extract<QbdBuildRequestResult, { outcome: "failed" }>;
}

function op(
  id: string,
  entityId: string,
  metadata: Record<string, unknown> | null = null
): QbdOperationInput {
  return { id, entityId, metadata };
}

function singleResponse(xml: string) {
  const responses = parseMessageSetResponse(xml);
  const first = responses[0];
  if (!first) throw new Error("fixture produced no responses");
  return first;
}

// =====================================================================
// Fixtures
// =====================================================================

const makeContact = (
  overrides?: Partial<Accounting.Contact>
): Accounting.Contact => ({
  id: "cust-1",
  name: "Acme Manufacturing",
  firstName: "Jane",
  lastName: "Doe",
  companyId: "company-1",
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
  raw: {},
  ...overrides
});

const CUSTOMER_FIELDS_XML =
  "<Name>Acme Manufacturing</Name>" +
  "<BillAddress><Addr1>1 Factory Way</Addr1><Addr2>Suite 2</Addr2><City>Cleveland</City><State>OH</State><PostalCode>44101</PostalCode><Country>US</Country></BillAddress>" +
  "<Phone>555-0100</Phone>" +
  "<Email>jane@acme.example</Email>";

class TestCustomerSyncer extends QbdCustomerSyncer {
  links: LinkRecord[] = [];

  constructor(
    public fixture: {
      local: Accounting.Contact | null;
      mapping: MappingStub;
    }
  ) {
    super(makeContext("customer"));
    (this as any).mappingService = {
      getByEntity: async () => this.fixture.mapping,
      getExternalId: async () => null
    };
  }

  async fetchLocal(): Promise<Accounting.Contact | null> {
    return this.fixture.local;
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.links.push({ entityId, externalId, editSequence });
  }
}

class TestVendorSyncer extends QbdVendorSyncer {
  links: LinkRecord[] = [];

  constructor(
    public fixture: {
      local: Accounting.Contact | null;
      mapping: MappingStub;
    }
  ) {
    super(makeContext("vendor"));
    (this as any).mappingService = {
      getByEntity: async () => this.fixture.mapping,
      getExternalId: async () => null
    };
  }

  async fetchLocal(): Promise<Accounting.Contact | null> {
    return this.fixture.local;
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.links.push({ entityId, externalId, editSequence });
  }
}

// =====================================================================
// Customer — two-phase list flow
// =====================================================================

describe("QbdCustomerSyncer buildRequest (list flow)", () => {
  it("starts an unmapped op at the query-before-insert phase (golden XML)", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: null
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-cust-1", "cust-1"))
    );

    expect(result.phase).toBe("query");
    expect(result.requestXml).toBe(
      '<CustomerQueryRq requestID="op-cust-1"><FullName>Acme Manufacturing</FullName></CustomerQueryRq>'
    );
  });

  it("builds CustomerAddRq when the stored phase is add (golden XML)", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: null
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-cust-1", "cust-1", { qbdPhase: "add" }))
    );

    expect(result.phase).toBe("add");
    expect(result.requestXml).toBe(
      `<CustomerAddRq requestID="op-cust-1"><CustomerAdd>${CUSTOMER_FIELDS_XML}</CustomerAdd></CustomerAddRq>`
    );
  });

  it("builds CustomerModRq for a mapped op with a stored EditSequence (golden XML)", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: {
        externalId: "80000001-1234567890",
        metadata: { editSequence: "1751990000" }
      }
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-cust-1", "cust-1"))
    );

    expect(result.phase).toBe("mod");
    expect(result.requestXml).toBe(
      '<CustomerModRq requestID="op-cust-1"><CustomerMod>' +
        "<ListID>80000001-1234567890</ListID>" +
        "<EditSequence>1751990000</EditSequence>" +
        `${CUSTOMER_FIELDS_XML}</CustomerMod></CustomerModRq>`
    );
  });

  it("re-queries a mapped op flagged editSequenceRetry (stale-EditSequence recovery)", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: {
        externalId: "80000001-1234567890",
        metadata: { editSequence: "1751990000" }
      }
    });

    const result = expectRequest(
      await syncer.buildRequest(
        op("op-cust-r", "cust-1", { editSequenceRetry: true })
      )
    );
    expect(result.phase).toBe("query");
  });

  it("fails NAME_TOO_LONG (Warning) before spending a query round trip", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact({ name: "x".repeat(42) }),
      mapping: null
    });

    const result = expectFailed(
      await syncer.buildRequest(op("op-cust-1", "cust-1"))
    );

    expect(result.failure.errorCode).toBe("NAME_TOO_LONG");
    expect(result.failure.warning).toBe(true);
  });
});

describe("QbdCustomerSyncer processResponse (query hit / miss / add)", () => {
  const queryHitXml =
    '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
    '<CustomerQueryRs requestID="op-cust-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">' +
    "<CustomerRet><ListID>80000001-1234567890</ListID><EditSequence>1751990000</EditSequence>" +
    "<Name>Acme Manufacturing</Name><FullName>Acme Manufacturing</FullName></CustomerRet>" +
    "</CustomerQueryRs></QBXMLMsgsRs></QBXML>";

  const queryMissXml =
    '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
    '<CustomerQueryRs requestID="op-cust-1" statusCode="1" statusSeverity="Warn" statusMessage="A query request did not find a matching object in QuickBooks" />' +
    "</QBXMLMsgsRs></QBXML>";

  const addOkXml =
    '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
    '<CustomerAddRs requestID="op-cust-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">' +
    "<CustomerRet><ListID>80000002-999</ListID><EditSequence>1752000000</EditSequence>" +
    "<Name>Acme Manufacturing</Name></CustomerRet>" +
    "</CustomerAddRs></QBXMLMsgsRs></QBXML>";

  it("query hit links the existing QB customer and follows up with mod", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: null
    });

    const result = await syncer.processResponse(
      op("op-cust-1", "cust-1", { qbdPhase: "query" }),
      singleResponse(queryHitXml)
    );

    expect(result).toEqual({ outcome: "needs-followup", nextPhase: "mod" });
    expect(syncer.links).toEqual([
      {
        entityId: "cust-1",
        externalId: "80000001-1234567890",
        editSequence: "1751990000"
      }
    ]);
  });

  it("query miss advances to add without linking anything", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: null
    });

    const result = await syncer.processResponse(
      op("op-cust-1", "cust-1", { qbdPhase: "query" }),
      singleResponse(queryMissXml)
    );

    expect(result).toEqual({ outcome: "needs-followup", nextPhase: "add" });
    expect(syncer.links).toEqual([]);
  });

  it("add response links the new ListID and completes", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: null
    });

    const result = await syncer.processResponse(
      op("op-cust-1", "cust-1", { qbdPhase: "add" }),
      singleResponse(addOkXml)
    );

    expect(result).toEqual({
      outcome: "completed",
      externalId: "80000002-999",
      editSequence: "1752000000"
    });
    expect(syncer.links).toEqual([
      {
        entityId: "cust-1",
        externalId: "80000002-999",
        editSequence: "1752000000"
      }
    ]);
  });

  it("walks the full query → add flow (miss) and query → mod flow (hit)", async () => {
    // Miss branch: query → needs-followup add → Add request
    const missSyncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: null
    });
    const first = expectRequest(
      await missSyncer.buildRequest(op("op-cust-1", "cust-1"))
    );
    expect(first.phase).toBe("query");

    const missFollowup = await missSyncer.processResponse(
      op("op-cust-1", "cust-1", { qbdPhase: "query" }),
      singleResponse(queryMissXml)
    );
    expect(missFollowup).toEqual({
      outcome: "needs-followup",
      nextPhase: "add"
    });

    // (the handler persists metadata.qbdPhase = "add")
    const second = expectRequest(
      await missSyncer.buildRequest(
        op("op-cust-1", "cust-1", { qbdPhase: "add" })
      )
    );
    expect(second.phase).toBe("add");
    expect(second.requestXml).toContain("<CustomerAdd>");

    // Hit branch: query → link + needs-followup mod → Mod request with the
    // linked ListID/EditSequence
    const hitSyncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: null
    });
    const hitFollowup = await hitSyncer.processResponse(
      op("op-cust-1", "cust-1", { qbdPhase: "query" }),
      singleResponse(queryHitXml)
    );
    expect(hitFollowup).toEqual({
      outcome: "needs-followup",
      nextPhase: "mod"
    });

    // (the link is now the stored mapping; the handler persists phase mod)
    hitSyncer.fixture.mapping = {
      externalId: "80000001-1234567890",
      metadata: { editSequence: "1751990000" }
    };
    const mod = expectRequest(
      await hitSyncer.buildRequest(
        op("op-cust-1", "cust-1", { qbdPhase: "mod" })
      )
    );
    expect(mod.phase).toBe("mod");
    expect(mod.requestXml).toContain("<ListID>80000001-1234567890</ListID>");
    expect(mod.requestXml).toContain("<EditSequence>1751990000</EditSequence>");
  });

  it("throws when the handler forwards a status it owns (warning/retryable/fatal)", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: null
    });

    const nameExistsXml =
      '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
      '<CustomerAddRs requestID="op-cust-1" statusCode="3100" statusSeverity="Error" statusMessage="The name already exists" />' +
      "</QBXMLMsgsRs></QBXML>";

    await expect(
      syncer.processResponse(
        op("op-cust-1", "cust-1", { qbdPhase: "add" }),
        singleResponse(nameExistsXml)
      )
    ).rejects.toThrow(/QBWC handler owns warning\/retryable\/fatal/);
  });
});

// =====================================================================
// Vendor
// =====================================================================

describe("QbdVendorSyncer", () => {
  it("builds VendorAddRq with VendorAddress (golden XML)", async () => {
    const syncer = new TestVendorSyncer({
      local: makeContact({
        id: "supp-1",
        name: "Steel Supply Co",
        isVendor: true,
        isCustomer: false,
        email: "ap@steel.example"
      }),
      mapping: null
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-vend-1", "supp-1", { qbdPhase: "add" }))
    );

    expect(result.requestXml).toBe(
      '<VendorAddRq requestID="op-vend-1"><VendorAdd>' +
        "<Name>Steel Supply Co</Name>" +
        "<VendorAddress><Addr1>1 Factory Way</Addr1><Addr2>Suite 2</Addr2><City>Cleveland</City><State>OH</State><PostalCode>44101</PostalCode><Country>US</Country></VendorAddress>" +
        "<Phone>555-0100</Phone>" +
        "<Email>ap@steel.example</Email>" +
        "</VendorAdd></VendorAddRq>"
    );
  });

  it("fails NAME_TOO_LONG past 41 characters", async () => {
    const syncer = new TestVendorSyncer({
      local: makeContact({ name: "v".repeat(42) }),
      mapping: null
    });

    const result = expectFailed(
      await syncer.buildRequest(op("op-vend-1", "supp-1"))
    );
    expect(result.failure.errorCode).toBe("NAME_TOO_LONG");
  });

  it("links a VendorQuery hit and follows up with mod", async () => {
    const syncer = new TestVendorSyncer({
      local: makeContact({ name: "Steel Supply Co" }),
      mapping: null
    });

    const hitXml =
      '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
      '<VendorQueryRs requestID="op-vend-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">' +
      "<VendorRet><ListID>90000001-1</ListID><EditSequence>175</EditSequence><Name>Steel Supply Co</Name></VendorRet>" +
      "</VendorQueryRs></QBXMLMsgsRs></QBXML>";

    const result = await syncer.processResponse(
      op("op-vend-1", "supp-1", { qbdPhase: "query" }),
      singleResponse(hitXml)
    );

    expect(result).toEqual({ outcome: "needs-followup", nextPhase: "mod" });
    expect(syncer.links).toEqual([
      { entityId: "supp-1", externalId: "90000001-1", editSequence: "175" }
    ]);
  });
});

// =====================================================================
// Item
// =====================================================================

const makeItem = (overrides?: Partial<Accounting.Item>): Accounting.Item => ({
  id: "item-1",
  code: "PART-001",
  name: "Widget Item",
  description: "Widget",
  companyId: "company-1",
  type: "Part",
  unitOfMeasureCode: "EA",
  unitCost: 10,
  unitSalePrice: 25,
  isPurchased: true,
  isSold: true,
  isTrackedAsInventory: true,
  updatedAt: "2026-07-01T12:00:00.000Z",
  raw: {},
  ...overrides
});

class TestItemSyncer extends QbdItemSyncer {
  links: LinkRecord[] = [];

  constructor(
    public fixture: {
      local: Accounting.Item | null;
      mapping: MappingStub;
      accountListIds: Map<string, string>;
      defaults: {
        incomeAccountId: string | null;
        expenseAccountId: string | null;
      };
    }
  ) {
    super(makeContext("item"));
    (this as any).mappingService = {
      getByEntity: async () => this.fixture.mapping,
      getExternalId: async () => null
    };
    (this as any).accountListIdsByIdPromise = Promise.resolve(
      this.fixture.accountListIds
    );
    (this as any).defaultItemAccountsPromise = Promise.resolve(
      this.fixture.defaults
    );
  }

  async fetchLocal(): Promise<Accounting.Item | null> {
    return this.fixture.local;
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.links.push({ entityId, externalId, editSequence });
  }
}

describe("QbdItemSyncer", () => {
  it("builds ItemNonInventoryAddRq with mapped income/expense refs (golden XML)", async () => {
    const syncer = new TestItemSyncer({
      local: makeItem(),
      mapping: null,
      accountListIds: new Map([
        ["acct-sales", "QB-INC-1"],
        ["acct-cogs", "QB-COGS-1"]
      ]),
      defaults: { incomeAccountId: "acct-sales", expenseAccountId: "acct-cogs" }
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-item-1", "item-1", { qbdPhase: "add" }))
    );

    expect(result.requestXml).toBe(
      '<ItemNonInventoryAddRq requestID="op-item-1"><ItemNonInventoryAdd>' +
        "<Name>PART-001</Name>" +
        "<SalesAndPurchase>" +
        "<SalesDesc>Widget</SalesDesc><SalesPrice>25.00</SalesPrice>" +
        "<IncomeAccountRef><ListID>QB-INC-1</ListID></IncomeAccountRef>" +
        "<PurchaseDesc>Widget</PurchaseDesc><PurchaseCost>10.00</PurchaseCost>" +
        "<ExpenseAccountRef><ListID>QB-COGS-1</ListID></ExpenseAccountRef>" +
        "</SalesAndPurchase>" +
        "</ItemNonInventoryAdd></ItemNonInventoryAddRq>"
    );
  });

  it("fails UNMAPPED_ACCOUNTS (Warning) when the expense/COGS default is unmapped", async () => {
    const syncer = new TestItemSyncer({
      local: makeItem(),
      mapping: null,
      accountListIds: new Map([["acct-sales", "QB-INC-1"]]),
      defaults: { incomeAccountId: "acct-sales", expenseAccountId: "acct-cogs" }
    });

    const result = expectFailed(
      await syncer.buildRequest(op("op-item-1", "item-1", { qbdPhase: "add" }))
    );

    expect(result.failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(result.failure.warning).toBe(true);
  });

  it("queries by item code first when unmapped", async () => {
    const syncer = new TestItemSyncer({
      local: makeItem(),
      mapping: null,
      accountListIds: new Map([
        ["acct-sales", "QB-INC-1"],
        ["acct-cogs", "QB-COGS-1"]
      ]),
      defaults: { incomeAccountId: "acct-sales", expenseAccountId: "acct-cogs" }
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-item-1", "item-1"))
    );
    expect(result.phase).toBe("query");
    expect(result.requestXml).toBe(
      '<ItemNonInventoryQueryRq requestID="op-item-1"><FullName>PART-001</FullName></ItemNonInventoryQueryRq>'
    );
  });
});

// =====================================================================
// Invoice (transaction — Add-only, idempotent on mapping)
// =====================================================================

const makeInvoice = (
  overrides?: Partial<QbdSalesInvoiceLocal>
): QbdSalesInvoiceLocal => ({
  id: "slsinv_1",
  invoiceId: "SI000042",
  companyId: "company-1",
  customerId: "cust-1",
  customerExternalId: "QB-CUST-1",
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
  raw: {},
  ...overrides
});

class TestInvoiceSyncer extends QbdSalesInvoiceSyncer {
  links: LinkRecord[] = [];

  constructor(
    public fixture: {
      local: QbdSalesInvoiceLocal | null;
      mapping: MappingStub;
    }
  ) {
    super(makeContext("invoice"));
    (this as any).mappingService = {
      getByEntity: async () => this.fixture.mapping,
      getExternalId: async () => null
    };
  }

  async fetchLocal(): Promise<QbdSalesInvoiceLocal | null> {
    return this.fixture.local;
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.links.push({ entityId, externalId, editSequence });
  }
}

describe("QbdSalesInvoiceSyncer", () => {
  it("builds InvoiceAddRq directly — no query phase for transactions (golden XML)", async () => {
    const syncer = new TestInvoiceSyncer({
      local: makeInvoice(),
      mapping: null
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-inv-1", "slsinv_1"))
    );

    expect(result.phase).toBe("add");
    expect(result.requestXml).toBe(
      '<InvoiceAddRq requestID="op-inv-1"><InvoiceAdd>' +
        "<CustomerRef><ListID>QB-CUST-1</ListID></CustomerRef>" +
        "<TxnDate>2026-07-01</TxnDate>" +
        "<RefNumber>SI000042</RefNumber>" +
        "<DueDate>2026-07-31</DueDate>" +
        "<Memo>Carbon SI000042 slsinv_1</Memo>" +
        "<InvoiceLineAdd><ItemRef><ListID>QB-ITEM-1</ListID></ItemRef><Desc>Widget</Desc><Quantity>2</Quantity><Rate>250.00</Rate><Amount>500.00</Amount></InvoiceLineAdd>" +
        "</InvoiceAdd></InvoiceAddRq>"
    );
  });

  it("falls back to the customer FullName when the dependency is unmapped", async () => {
    const syncer = new TestInvoiceSyncer({
      local: makeInvoice({ customerExternalId: null }),
      mapping: null
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-inv-1", "slsinv_1"))
    );
    expect(result.requestXml).toContain(
      "<CustomerRef><FullName>Acme Manufacturing</FullName></CustomerRef>"
    );
  });

  it("completes idempotently when a mapping already exists (already pushed)", async () => {
    const syncer = new TestInvoiceSyncer({
      local: makeInvoice(),
      mapping: { externalId: "QB-TXN-9", metadata: null }
    });

    const result = expectCompleted(
      await syncer.buildRequest(op("op-inv-1", "slsinv_1"))
    );
    expect(result.externalId).toBe("QB-TXN-9");
    expect(result.reason).toContain("idempotent");
  });

  it("completes (not eligible) for a Draft invoice — status gate", async () => {
    const syncer = new TestInvoiceSyncer({
      local: makeInvoice({ status: "Draft" }),
      mapping: null
    });

    const result = expectCompleted(
      await syncer.buildRequest(op("op-inv-1", "slsinv_1"))
    );
    expect(result.reason).toContain("must be posted");
    expect(result.externalId).toBeUndefined();
  });

  it("processResponse links the TxnID and completes (D4 InvoiceAddRs fixture)", async () => {
    const syncer = new TestInvoiceSyncer({
      local: makeInvoice(),
      mapping: null
    });

    const addOkXml =
      '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
      '<InvoiceAddRs requestID="op-inv-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">' +
      "<InvoiceRet><TxnID>5D21-1622994339</TxnID><EditSequence>1622994339</EditSequence>" +
      "<RefNumber>SI000042</RefNumber><Memo>Carbon SI000042 slsinv_1</Memo></InvoiceRet>" +
      "</InvoiceAddRs></QBXMLMsgsRs></QBXML>";

    const result = await syncer.processResponse(
      op("op-inv-1", "slsinv_1", { qbdPhase: "add" }),
      singleResponse(addOkXml)
    );

    expect(result).toEqual({
      outcome: "completed",
      externalId: "5D21-1622994339",
      editSequence: "1622994339"
    });
    expect(syncer.links).toEqual([
      {
        entityId: "slsinv_1",
        externalId: "5D21-1622994339",
        editSequence: "1622994339"
      }
    ]);
  });
});

// =====================================================================
// Bill (transaction — expense lines via account mapping)
// =====================================================================

const makeBill = (overrides?: Partial<QbdBillLocal>): QbdBillLocal => ({
  id: "pinv_1",
  companyId: "company-1",
  invoiceId: "PI000007",
  supplierId: "supp-1",
  supplierExternalId: "QB-VEND-1",
  supplierName: "Steel Supply Co",
  status: "Pending",
  dateIssued: "2026-07-02",
  dateDue: "2026-08-01",
  datePaid: null,
  currencyCode: "USD",
  exchangeRate: 1,
  subtotal: 130,
  totalTax: 0,
  totalDiscount: 0,
  totalAmount: 130,
  balance: 130,
  supplierReference: null,
  lines: [
    {
      id: "line-exp",
      description: "Freight",
      quantity: 1,
      unitPrice: 100,
      itemId: null,
      itemCode: null,
      itemExternalId: null,
      accountId: "acct-6100",
      accountNumber: "6100",
      taxPercent: null,
      taxAmount: null,
      totalAmount: 100,
      purchaseOrderLineId: null
    },
    {
      id: "line-item",
      description: "Widget",
      quantity: 3,
      unitPrice: 10,
      itemId: "item-1",
      itemCode: "PART-001",
      itemExternalId: "QB-ITEM-1",
      accountId: null,
      accountNumber: null,
      taxPercent: null,
      taxAmount: null,
      totalAmount: 30,
      purchaseOrderLineId: null
    }
  ],
  updatedAt: "2026-07-02T12:00:00.000Z",
  raw: {},
  ...overrides
});

class TestBillSyncer extends QbdBillSyncer {
  links: LinkRecord[] = [];

  constructor(
    public fixture: {
      local: QbdBillLocal | null;
      mapping: MappingStub;
      accountListIds: Map<string, string>;
    }
  ) {
    super(makeContext("bill"));
    (this as any).mappingService = {
      getByEntity: async () => this.fixture.mapping,
      getExternalId: async () => null
    };
    (this as any).accountListIdsByIdPromise = Promise.resolve(
      this.fixture.accountListIds
    );
  }

  async fetchLocal(): Promise<QbdBillLocal | null> {
    return this.fixture.local;
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.links.push({ entityId, externalId, editSequence });
  }
}

describe("QbdBillSyncer", () => {
  it("builds BillAddRq with expense + item lines (golden XML — DueDate precedes RefNumber)", async () => {
    const syncer = new TestBillSyncer({
      local: makeBill(),
      mapping: null,
      accountListIds: new Map([["acct-6100", "QB-ACCT-6100"]])
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-bill-1", "pinv_1"))
    );

    expect(result.phase).toBe("add");
    expect(result.requestXml).toBe(
      '<BillAddRq requestID="op-bill-1"><BillAdd>' +
        "<VendorRef><ListID>QB-VEND-1</ListID></VendorRef>" +
        "<TxnDate>2026-07-02</TxnDate>" +
        "<DueDate>2026-08-01</DueDate>" +
        "<RefNumber>PI000007</RefNumber>" +
        "<Memo>Carbon PI000007 pinv_1</Memo>" +
        "<ExpenseLineAdd><AccountRef><ListID>QB-ACCT-6100</ListID></AccountRef><Amount>100.00</Amount><Memo>Freight</Memo></ExpenseLineAdd>" +
        "<ItemLineAdd><ItemRef><ListID>QB-ITEM-1</ListID></ItemRef><Desc>Widget</Desc><Quantity>3</Quantity><Cost>10.00</Cost><Amount>30.00</Amount></ItemLineAdd>" +
        "</BillAdd></BillAddRq>"
    );
  });

  it("fails UNMAPPED_ACCOUNTS (Warning) when an expense line's account is unmapped", async () => {
    const syncer = new TestBillSyncer({
      local: makeBill(),
      mapping: null,
      accountListIds: new Map()
    });

    const result = expectFailed(
      await syncer.buildRequest(op("op-bill-1", "pinv_1"))
    );
    expect(result.failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(result.failure.warning).toBe(true);
  });

  it("completes idempotently when the bill is already mapped", async () => {
    const syncer = new TestBillSyncer({
      local: makeBill(),
      mapping: { externalId: "QB-TXN-7", metadata: null },
      accountListIds: new Map()
    });

    const result = expectCompleted(
      await syncer.buildRequest(op("op-bill-1", "pinv_1"))
    );
    expect(result.externalId).toBe("QB-TXN-7");
  });

  it("toQbdBillInput splits item vs expense lines (pure)", () => {
    const input = toQbdBillInput(
      makeBill(),
      new Map([["acct-6100", "QB-ACCT-6100"]])
    );
    expect(input.itemLines).toHaveLength(1);
    expect(input.expenseLines).toHaveLength(1);
    expect(input.expenseLines?.[0]?.accountRef.listId).toBe("QB-ACCT-6100");
    expect(input.itemLines?.[0]?.itemRef.listId).toBe("QB-ITEM-1");
  });
});

// =====================================================================
// Purchase order (transaction)
// =====================================================================

const makePurchaseOrder = (
  overrides?: Partial<QbdPurchaseOrderLocal>
): QbdPurchaseOrderLocal => ({
  id: "po_1",
  companyId: "company-1",
  purchaseOrderId: "PO000011",
  supplierId: "supp-1",
  supplierExternalId: "QB-VEND-1",
  supplierName: "Steel Supply Co",
  status: "To Receive",
  orderDate: "2026-06-20",
  deliveryDate: "2026-07-15",
  deliveryAddress: null,
  deliveryInstructions: null,
  currencyCode: "USD",
  exchangeRate: 1,
  subtotal: 50,
  totalTax: 0,
  totalAmount: 50,
  supplierReference: null,
  lines: [
    {
      id: "line-1",
      description: "Widget",
      quantity: 5,
      unitPrice: 10,
      itemId: "item-1",
      itemCode: "PART-001",
      itemExternalId: "QB-ITEM-1",
      accountId: null,
      accountNumber: null,
      taxPercent: null,
      taxAmount: null,
      totalAmount: 50,
      quantityReceived: 0,
      quantityInvoiced: 0
    }
  ],
  updatedAt: "2026-06-20T12:00:00.000Z",
  raw: {},
  ...overrides
});

class TestPurchaseOrderSyncer extends QbdPurchaseOrderSyncer {
  links: LinkRecord[] = [];

  constructor(
    public fixture: {
      local: QbdPurchaseOrderLocal | null;
      mapping: MappingStub;
    }
  ) {
    super(makeContext("purchaseOrder"));
    (this as any).mappingService = {
      getByEntity: async () => this.fixture.mapping,
      getExternalId: async () => null
    };
  }

  async fetchLocal(): Promise<QbdPurchaseOrderLocal | null> {
    return this.fixture.local;
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.links.push({ entityId, externalId, editSequence });
  }
}

describe("QbdPurchaseOrderSyncer", () => {
  it("builds PurchaseOrderAddRq with ExpectedDate from deliveryDate (golden XML)", async () => {
    const syncer = new TestPurchaseOrderSyncer({
      local: makePurchaseOrder(),
      mapping: null
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-po-1", "po_1"))
    );

    expect(result.requestXml).toBe(
      '<PurchaseOrderAddRq requestID="op-po-1"><PurchaseOrderAdd>' +
        "<VendorRef><ListID>QB-VEND-1</ListID></VendorRef>" +
        "<TxnDate>2026-06-20</TxnDate>" +
        "<RefNumber>PO000011</RefNumber>" +
        "<ExpectedDate>2026-07-15</ExpectedDate>" +
        "<Memo>Carbon PO000011 po_1</Memo>" +
        "<PurchaseOrderLineAdd><ItemRef><ListID>QB-ITEM-1</ListID></ItemRef><Desc>Widget</Desc><Quantity>5</Quantity><Rate>10.00</Rate><Amount>50.00</Amount></PurchaseOrderLineAdd>" +
        "</PurchaseOrderAdd></PurchaseOrderAddRq>"
    );
  });

  it("completes (not eligible) for a Draft purchase order — status gate", async () => {
    const syncer = new TestPurchaseOrderSyncer({
      local: makePurchaseOrder({ status: "Draft" }),
      mapping: null
    });

    const result = expectCompleted(
      await syncer.buildRequest(op("op-po-1", "po_1"))
    );
    expect(result.reason).toContain("must be released");
  });

  it("toQbdPurchaseOrderInput maps line rate/amount (pure)", () => {
    const input = toQbdPurchaseOrderInput(makePurchaseOrder());
    expect(input.lines[0]?.rate).toBe(10);
    expect(input.lines[0]?.amount).toBe(50);
    expect(input.expectedDate).toBe("2026-07-15");
  });
});

// =====================================================================
// Journal entry (posting sync pre-flights)
// =====================================================================

const makeJournal = (
  overrides?: Partial<Accounting.JournalEntry>
): Accounting.JournalEntry => ({
  id: "je_1",
  companyId: "company-1",
  journalEntryId: "JE000123",
  description: null,
  postingDate: "2026-07-03",
  status: "Posted",
  sourceType: "Purchase Receipt",
  reversalOfId: null,
  reversedById: null,
  reversal: false,
  lines: [
    { id: "jl-1", accountId: "acct-a", amount: 500, description: null },
    { id: "jl-2", accountId: "acct-b", amount: -500, description: null }
  ],
  updatedAt: "2026-07-03T12:00:00.000Z",
  ...overrides
});

const enabledSettings: PostingSyncSettings = {
  ...DEFAULT_POSTING_SYNC_SETTINGS,
  enabled: true
};

class TestJournalSyncer extends QbdJournalEntrySyncer {
  links: LinkRecord[] = [];

  constructor(
    public fixture: {
      journal: Accounting.JournalEntry | null;
      mappings: Record<string, MappingStub>;
      settings: PostingSyncSettings;
      accountListIds: Map<string, string>;
      controlAccountIds?: Set<string>;
    }
  ) {
    super(makeContext("journalEntry"));
    (this as any).mappingService = {
      getByEntity: async (_entityType: string, entityId: string) =>
        this.fixture.mappings[entityId] ?? null,
      getExternalId: async () => null
    };
  }

  async fetchLocal(): Promise<Accounting.JournalEntry | null> {
    return this.fixture.journal;
  }

  getPostingSyncSettings(): Promise<PostingSyncSettings> {
    return Promise.resolve(this.fixture.settings);
  }

  getAccountListIdsById(): Promise<Map<string, string>> {
    return Promise.resolve(this.fixture.accountListIds);
  }

  getControlAccountIds(): Promise<Set<string>> {
    return Promise.resolve(this.fixture.controlAccountIds ?? new Set());
  }

  protected async persistLink(
    entityId: string,
    externalId: string,
    editSequence: string | null
  ): Promise<void> {
    this.links.push({ entityId, externalId, editSequence });
  }
}

const journalAccountListIds = new Map([
  ["acct-a", "QB-ACCT-A"],
  ["acct-b", "QB-ACCT-B"]
]);

describe("QbdJournalEntrySyncer", () => {
  it("builds a balanced JournalEntryAddRq with mapped account ListIDs (golden XML)", async () => {
    const syncer = new TestJournalSyncer({
      journal: makeJournal(),
      mappings: {},
      settings: enabledSettings,
      accountListIds: journalAccountListIds
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-je-1", "je_1"))
    );

    expect(result.phase).toBe("add");
    expect(result.requestXml).toBe(
      '<JournalEntryAddRq requestID="op-je-1"><JournalEntryAdd>' +
        "<TxnDate>2026-07-03</TxnDate>" +
        "<RefNumber>JE000123</RefNumber>" +
        "<JournalDebitLine><AccountRef><ListID>QB-ACCT-A</ListID></AccountRef><Amount>500.00</Amount><Memo>Carbon JE000123 je_1</Memo></JournalDebitLine>" +
        "<JournalCreditLine><AccountRef><ListID>QB-ACCT-B</ListID></AccountRef><Amount>500.00</Amount><Memo>Carbon JE000123 je_1</Memo></JournalCreditLine>" +
        "</JournalEntryAdd></JournalEntryAddRq>"
    );
  });

  it("negates line amounts for a reversal push (sides flip, memo carries the suffixed id)", async () => {
    const syncer = new TestJournalSyncer({
      journal: makeJournal({ reversal: true, status: "Reversed" }),
      mappings: {
        // The ORIGINAL journal was pushed; the reversal itself is unmapped
        je_1: { externalId: "QB-TXN-1", metadata: null },
        "je_1:reversal": null
      },
      settings: enabledSettings,
      accountListIds: journalAccountListIds
    });

    const result = expectRequest(
      await syncer.buildRequest(op("op-je-2", "je_1:reversal"))
    );

    expect(result.requestXml).toBe(
      '<JournalEntryAddRq requestID="op-je-2"><JournalEntryAdd>' +
        "<TxnDate>2026-07-03</TxnDate>" +
        "<RefNumber>JE000123</RefNumber>" +
        "<JournalCreditLine><AccountRef><ListID>QB-ACCT-A</ListID></AccountRef><Amount>500.00</Amount><Memo>Carbon JE000123 je_1:reversal</Memo></JournalCreditLine>" +
        "<JournalDebitLine><AccountRef><ListID>QB-ACCT-B</ListID></AccountRef><Amount>500.00</Amount><Memo>Carbon JE000123 je_1:reversal</Memo></JournalDebitLine>" +
        "</JournalEntryAdd></JournalEntryAddRq>"
    );
  });

  it("fails UNMAPPED_ACCOUNTS (Warning) via the shared pre-flight", async () => {
    const syncer = new TestJournalSyncer({
      journal: makeJournal(),
      mappings: {},
      settings: enabledSettings,
      accountListIds: new Map([["acct-a", "QB-ACCT-A"]]) // acct-b unmapped
    });

    const result = expectFailed(
      await syncer.buildRequest(op("op-je-1", "je_1"))
    );

    expect(result.failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(result.failure.warning).toBe(true);
    expect(result.failure.metadata?.unmappedAccountIds).toEqual(["acct-b"]);
  });

  it("fails PERIOD_LOCKED (Warning) against the manual lock date under park", async () => {
    const syncer = new TestJournalSyncer({
      journal: makeJournal(),
      mappings: {},
      settings: { ...enabledSettings, lockDate: "2026-07-10" },
      accountListIds: journalAccountListIds
    });

    const result = expectFailed(
      await syncer.buildRequest(op("op-je-1", "je_1"))
    );
    expect(result.failure.errorCode).toBe("PERIOD_LOCKED");
    expect(result.failure.warning).toBe(true);
  });

  it("completes idempotently when the journal push is already mapped", async () => {
    const syncer = new TestJournalSyncer({
      journal: makeJournal(),
      mappings: { je_1: { externalId: "QB-TXN-1", metadata: null } },
      settings: enabledSettings,
      accountListIds: journalAccountListIds
    });

    const result = expectCompleted(
      await syncer.buildRequest(op("op-je-1", "je_1"))
    );
    expect(result.externalId).toBe("QB-TXN-1");
    expect(result.reason).toContain("idempotent");
  });

  it("completes (not eligible) when the sourceType is document-backed", async () => {
    const syncer = new TestJournalSyncer({
      journal: makeJournal({ sourceType: "Sales Invoice" }),
      mappings: {},
      settings: enabledSettings,
      accountListIds: journalAccountListIds
    });

    const result = expectCompleted(
      await syncer.buildRequest(op("op-je-1", "je_1"))
    );
    expect(result.reason).toContain("document-backed");
  });

  it("processResponse links the TxnID and completes", async () => {
    const syncer = new TestJournalSyncer({
      journal: makeJournal(),
      mappings: {},
      settings: enabledSettings,
      accountListIds: journalAccountListIds
    });

    const addOkXml =
      '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
      '<JournalEntryAddRs requestID="op-je-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">' +
      "<JournalEntryRet><TxnID>7A15-1622990001</TxnID><EditSequence>1622990001</EditSequence>" +
      "<RefNumber>JE000123</RefNumber></JournalEntryRet>" +
      "</JournalEntryAddRs></QBXMLMsgsRs></QBXML>";

    const result = await syncer.processResponse(
      op("op-je-1", "je_1", { qbdPhase: "add" }),
      singleResponse(addOkXml)
    );

    expect(result).toEqual({
      outcome: "completed",
      externalId: "7A15-1622990001",
      editSequence: "1622990001"
    });
    expect(syncer.links).toEqual([
      {
        entityId: "je_1",
        externalId: "7A15-1622990001",
        editSequence: "1622990001"
      }
    ]);
  });

  it("buildQbdJournalEntryInput folds a redate note onto the first line (pure)", () => {
    const input = buildQbdJournalEntryInput({
      journal: makeJournal(),
      entityId: "je_1",
      accountListIdsById: journalAccountListIds,
      pushDate: "2026-07-11",
      redatedFromDate: "2026-07-03"
    });

    expect(input.postingDate).toBe("2026-07-11");
    expect(input.lines[0]?.description).toBe("original date 2026-07-03");
    expect(input.lines[1]?.description).toBeNull();
  });
});

// =====================================================================
// resolveQbdListPhase (pure phase resolution)
// =====================================================================

describe("resolveQbdListPhase", () => {
  it("starts unmapped ops at query", () => {
    expect(resolveQbdListPhase(op("op", "e"), null)).toBe("query");
  });

  it("mods mapped ops with a stored EditSequence", () => {
    expect(
      resolveQbdListPhase(op("op", "e"), {
        externalId: "L1",
        metadata: { editSequence: "17" }
      })
    ).toBe("mod");
  });

  it("re-queries mapped ops without a stored EditSequence", () => {
    expect(
      resolveQbdListPhase(op("op", "e"), { externalId: "L1", metadata: null })
    ).toBe("query");
  });

  it("re-queries on the editSequenceRetry flag (stale-EditSequence recovery)", () => {
    expect(
      resolveQbdListPhase(op("op", "e", { editSequenceRetry: true }), {
        externalId: "L1",
        metadata: { editSequence: "17" }
      })
    ).toBe("query");
  });

  it("lets a stored qbdPhase win over derivation", () => {
    expect(resolveQbdListPhase(op("op", "e", { qbdPhase: "add" }), null)).toBe(
      "add"
    );
    expect(
      resolveQbdListPhase(op("op", "e", { qbdPhase: "mod" }), {
        externalId: "L1",
        metadata: { editSequence: "17" }
      })
    ).toBe("mod");
  });
});

// =====================================================================
// QbdProvider + sync config + polled push/pull surface
// =====================================================================

describe("buildQbdSyncConfig", () => {
  const config = buildQbdSyncConfig(DEFAULT_SYNC_CONFIG);

  it("forces every supported entity push-only with owner carbon", () => {
    for (const entity of [
      "customer",
      "vendor",
      "item",
      "invoice",
      "bill",
      "purchaseOrder",
      "journalEntry"
    ] as const) {
      expect(config.entities[entity].direction).toBe("push-to-accounting");
      expect(config.entities[entity].owner).toBe("carbon");
    }
  });

  it("keeps the per-company enabled flags (journalEntry stays opt-in)", () => {
    expect(config.entities.customer.enabled).toBe(true);
    expect(config.entities.journalEntry.enabled).toBe(false);
  });

  it("force-disables the unsupported entities", () => {
    for (const entity of [
      "salesOrder",
      "inventoryAdjustment",
      "payment",
      "employee"
    ] as const) {
      expect(config.entities[entity].enabled).toBe(false);
    }
  });

  it("does not mutate the input config", () => {
    expect(DEFAULT_SYNC_CONFIG.entities.customer.direction).toBe("two-way");
  });
});

describe("QbdProvider", () => {
  const webConnectorCredentials = {
    type: "webConnector" as const,
    username: "carbon-company-1",
    passwordHash: "scrypt$c2FsdA$aGFzaA",
    ownerId: "{C1885F59-B650-49EE-93B7-CDDC31482121}",
    fileId: "{9AF40000-0000-0000-0000-000000000001}",
    qbxmlVersion: "16.0"
  };

  it("declares the polled transport capabilities", () => {
    const provider = new QbdProvider({
      companyId: "company-1",
      syncConfig: DEFAULT_SYNC_CONFIG
    });
    expect(provider.capabilities).toEqual({
      transport: "polled",
      supportsWebhooks: false,
      supportsJournalPush: true
    });
    expect(provider.id).toBe("quickbooks-desktop");
  });

  it("validates when webConnector credentials are present (credentials-only)", async () => {
    const provider = new QbdProvider({
      companyId: "company-1",
      syncConfig: DEFAULT_SYNC_CONFIG,
      credentials: webConnectorCredentials
    });
    await expect(provider.validate()).resolves.toBe(true);
    expect(provider.getWebConnectorCredentials()?.username).toBe(
      "carbon-company-1"
    );
    expect(provider.qbxmlVersion).toBe("16.0");
  });

  it("fails validation without credentials or with a non-webConnector variant", async () => {
    const missing = new QbdProvider({
      companyId: "company-1",
      syncConfig: DEFAULT_SYNC_CONFIG
    });
    await expect(missing.validate()).resolves.toBe(false);

    const oauth = new QbdProvider({
      companyId: "company-1",
      syncConfig: DEFAULT_SYNC_CONFIG,
      credentials: { type: "oauth2", accessToken: "tok" }
    });
    await expect(oauth.validate()).resolves.toBe(false);
    expect(oauth.getWebConnectorCredentials()).toBeNull();
  });

  it("has no OAuth flow", async () => {
    const provider = new QbdProvider({
      companyId: "company-1",
      syncConfig: DEFAULT_SYNC_CONFIG
    });
    await expect(provider.authenticate()).rejects.toThrow(/Web Connector/);
    expect(() => provider.auth.getCredentials()).toThrow(
      /no stored credentials/
    );
  });

  it("getSyncConfig serves the constrained push-only config", () => {
    const provider = new QbdProvider({
      companyId: "company-1",
      syncConfig: DEFAULT_SYNC_CONFIG
    });
    expect(provider.getSyncConfig("customer")).toEqual({
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    });
    expect(provider.getSyncConfig("payment").enabled).toBe(false);
  });
});

describe("polled transport push/pull surface", () => {
  it("pushToAccounting / pullFromAccounting return the descriptive polled-transport error", async () => {
    const syncer = new TestCustomerSyncer({
      local: makeContact(),
      mapping: null
    });

    const push = await syncer.pushToAccounting("cust-1");
    expect(push.status).toBe("error");
    expect(push.error).toBe(QBD_POLLED_TRANSPORT_ERROR);

    const pull = await syncer.pullFromAccounting("80000001-1");
    expect(pull.status).toBe("error");
    expect(pull.error).toBe(QBD_POLLED_TRANSPORT_ERROR);

    const pushBatch = await syncer.pushBatchToAccounting(["a", "b"]);
    expect(pushBatch.errorCount).toBe(2);
    expect(pushBatch.results[0]?.error).toBe(QBD_POLLED_TRANSPORT_ERROR);
  });
});
