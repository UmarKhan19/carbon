import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isJournalEntrySyncFailure } from "../../../../../core/posting";
import { xmlEscape } from "../../envelope";
import { QbxmlValidationError } from "../../errors";
import { parseMessageSetResponse } from "../../parse";
import * as bill from "../bill";
import * as customer from "../customer";
import * as invoice from "../invoice";
import * as item from "../item-non-inventory";
import * as journalEntry from "../journal-entry";
import * as purchaseOrder from "../purchase-order";
import {
  buildCarbonMemo,
  fitRefNumber,
  QBD_ITEM_NAME_MAX_LENGTH,
  QBD_LIST_NAME_MAX_LENGTH,
  QBD_REF_NUMBER_MAX_LENGTH
} from "../shared";
import * as vendor from "../vendor";

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

function catchValidationError(fn: () => unknown): QbxmlValidationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(QbxmlValidationError);
    return error as QbxmlValidationError;
  }
  throw new Error("expected QbxmlValidationError to be thrown");
}

// =====================================================================
// Customer
// =====================================================================

describe("customer builders", () => {
  it("buildAddRq golden snapshot (OSR element order)", () => {
    expect(
      customer.buildAddRq({
        requestID: "op-cust-1",
        customer: {
          name: "Acme Manufacturing",
          companyName: "Acme Manufacturing LLC",
          phone: "555-0100",
          email: "ap@acme.example",
          billingAddress: {
            line1: "1 Factory Way",
            line2: "Suite 2",
            city: "Cleveland",
            state: "OH",
            postalCode: "44101",
            country: "US"
          }
        }
      })
    ).toBe(
      '<CustomerAddRq requestID="op-cust-1"><CustomerAdd>' +
        "<Name>Acme Manufacturing</Name>" +
        "<CompanyName>Acme Manufacturing LLC</CompanyName>" +
        "<BillAddress><Addr1>1 Factory Way</Addr1><Addr2>Suite 2</Addr2><City>Cleveland</City><State>OH</State><PostalCode>44101</PostalCode><Country>US</Country></BillAddress>" +
        "<Phone>555-0100</Phone>" +
        "<Email>ap@acme.example</Email>" +
        "</CustomerAdd></CustomerAddRq>"
    );
  });

  it("buildModRq golden snapshot carries ListID + EditSequence", () => {
    expect(
      customer.buildModRq({
        requestID: "op-cust-3",
        listId: "80000001-1234567890",
        editSequence: "1751990000",
        customer: { name: "Acme Manufacturing" }
      })
    ).toBe(
      '<CustomerModRq requestID="op-cust-3"><CustomerMod>' +
        "<ListID>80000001-1234567890</ListID>" +
        "<EditSequence>1751990000</EditSequence>" +
        "<Name>Acme Manufacturing</Name>" +
        "</CustomerMod></CustomerModRq>"
    );
  });

  it("buildQueryRq queries by exact FullName (query-before-insert)", () => {
    expect(
      customer.buildQueryRq({
        requestID: "op-cust-q1",
        fullName: "Acme Manufacturing"
      })
    ).toBe(
      '<CustomerQueryRq requestID="op-cust-q1"><FullName>Acme Manufacturing</FullName></CustomerQueryRq>'
    );
  });

  it("throws NAME_TOO_LONG past 41 characters — no silent truncation", () => {
    const name = "x".repeat(QBD_LIST_NAME_MAX_LENGTH + 1);
    const error = catchValidationError(() =>
      customer.buildAddRq({ requestID: "op-x", customer: { name } })
    );

    expect(error.failure.errorCode).toBe("NAME_TOO_LONG");
    expect(error.failure.warning).toBe(true);
    expect(error.failure.metadata?.maxLength).toBe(41);
    expect(isJournalEntrySyncFailure(error.failure)).toBe(true);
  });

  it("applies the 41-char cap per hierarchy level, not to the whole name", () => {
    const perLevelOk = `${"a".repeat(41)}:${"b".repeat(41)}`;
    expect(
      customer.buildAddRq({
        requestID: "op-x",
        customer: { name: perLevelOk }
      })
    ).toContain(`<Name>${perLevelOk}</Name>`);

    const secondLevelTooLong = `Parent:${"b".repeat(42)}`;
    const error = catchValidationError(() =>
      customer.buildAddRq({
        requestID: "op-x",
        customer: { name: secondLevelTooLong }
      })
    );
    expect(error.failure.errorCode).toBe("NAME_TOO_LONG");
  });

  it("throws NAME_TOO_LONG for an address line over 41 characters", () => {
    const error = catchValidationError(() =>
      customer.buildAddRq({
        requestID: "op-x",
        customer: {
          name: "Acme",
          billingAddress: { line1: "x".repeat(42) }
        }
      })
    );

    expect(error.failure.errorCode).toBe("NAME_TOO_LONG");
    expect(error.failure.message).toContain("address line 1");
  });

  it("parseRet extracts ListID/EditSequence/FullName from a query response", () => {
    const responses = parseMessageSetResponse(
      fixture("customer-query-response.xml")
    );
    const ret = customer.parseRet(responses[0]!.payload);

    expect(ret).toMatchObject({
      listId: "80000001-1234567890",
      editSequence: "1751990000",
      fullName: "Acme Manufacturing",
      name: "Acme Manufacturing"
    });
    expect(ret?.fields.CompanyName).toBe("Acme Manufacturing LLC");
    expect(
      (ret?.fields.BillAddress as Record<string, unknown> | undefined)?.City
    ).toBe("Cleveland");
  });

  it("parseRet returns null for an empty payload (statusCode 1 query miss)", () => {
    expect(customer.parseRet(null)).toBeNull();
  });

  it("parseRet throws on a Ret without a ListID", () => {
    expect(() => customer.parseRet({ Name: "No ListID" })).toThrow(
      /missing ListID/
    );
  });
});

// =====================================================================
// Vendor
// =====================================================================

describe("vendor builders", () => {
  it("buildAddRq golden snapshot uses VendorAddress (not BillAddress)", () => {
    expect(
      vendor.buildAddRq({
        requestID: "op-vend-1",
        vendor: {
          name: "Steel Supply Co",
          phone: "555-0199",
          email: "ar@steel.example",
          address: {
            line1: "9 Mill Rd",
            city: "Gary",
            state: "IN",
            postalCode: "46402"
          }
        }
      })
    ).toBe(
      '<VendorAddRq requestID="op-vend-1"><VendorAdd>' +
        "<Name>Steel Supply Co</Name>" +
        "<VendorAddress><Addr1>9 Mill Rd</Addr1><City>Gary</City><State>IN</State><PostalCode>46402</PostalCode></VendorAddress>" +
        "<Phone>555-0199</Phone>" +
        "<Email>ar@steel.example</Email>" +
        "</VendorAdd></VendorAddRq>"
    );
  });

  it("buildModRq + buildQueryRq golden snapshots", () => {
    expect(
      vendor.buildModRq({
        requestID: "op-vend-2",
        listId: "80000009-999",
        editSequence: "42",
        vendor: { name: "Steel Supply Co" }
      })
    ).toBe(
      '<VendorModRq requestID="op-vend-2"><VendorMod><ListID>80000009-999</ListID><EditSequence>42</EditSequence><Name>Steel Supply Co</Name></VendorMod></VendorModRq>'
    );
    expect(
      vendor.buildQueryRq({
        requestID: "op-vend-q1",
        fullName: "Steel Supply Co"
      })
    ).toBe(
      '<VendorQueryRq requestID="op-vend-q1"><FullName>Steel Supply Co</FullName></VendorQueryRq>'
    );
  });

  it("throws NAME_TOO_LONG past 41 characters", () => {
    const error = catchValidationError(() =>
      vendor.buildAddRq({
        requestID: "op-x",
        vendor: { name: "x".repeat(42) }
      })
    );
    expect(error.failure.errorCode).toBe("NAME_TOO_LONG");
    expect(error.failure.warning).toBe(true);
  });

  it("parseRet reads a VendorRet", () => {
    const ret = vendor.parseRet({
      ListID: "80000009-999",
      EditSequence: "42",
      Name: "Steel Supply Co"
    });
    expect(ret).toMatchObject({
      listId: "80000009-999",
      editSequence: "42",
      fullName: "Steel Supply Co"
    });
  });
});

// =====================================================================
// Item (non-inventory)
// =====================================================================

describe("item-non-inventory builders", () => {
  const accountRefs = {
    incomeAccountRef: { listId: "80000030-333" },
    expenseAccountRef: { listId: "80000040-444" }
  };

  it("buildAddRq golden snapshot with the SalesAndPurchase block", () => {
    expect(
      item.buildAddRq({
        requestID: "op-item-1",
        item: {
          name: "WIDGET-100",
          salesDescription: "Widget, anodized",
          salesPrice: 25,
          purchaseDescription: "Widget raw",
          purchaseCost: 10.5,
          ...accountRefs
        }
      })
    ).toBe(
      '<ItemNonInventoryAddRq requestID="op-item-1"><ItemNonInventoryAdd>' +
        "<Name>WIDGET-100</Name>" +
        "<SalesAndPurchase>" +
        "<SalesDesc>Widget, anodized</SalesDesc>" +
        "<SalesPrice>25.00</SalesPrice>" +
        "<IncomeAccountRef><ListID>80000030-333</ListID></IncomeAccountRef>" +
        "<PurchaseDesc>Widget raw</PurchaseDesc>" +
        "<PurchaseCost>10.50</PurchaseCost>" +
        "<ExpenseAccountRef><ListID>80000040-444</ListID></ExpenseAccountRef>" +
        "</SalesAndPurchase>" +
        "</ItemNonInventoryAdd></ItemNonInventoryAddRq>"
    );
  });

  it("buildModRq golden snapshot uses SalesAndPurchaseMod and allows a FullName fallback ref", () => {
    expect(
      item.buildModRq({
        requestID: "op-item-2",
        listId: "80000050-555",
        editSequence: "1622990000",
        item: {
          name: "WIDGET-100",
          incomeAccountRef: { listId: "80000030-333" },
          expenseAccountRef: { fullName: "Cost of Goods Sold" }
        }
      })
    ).toBe(
      '<ItemNonInventoryModRq requestID="op-item-2"><ItemNonInventoryMod>' +
        "<ListID>80000050-555</ListID>" +
        "<EditSequence>1622990000</EditSequence>" +
        "<Name>WIDGET-100</Name>" +
        "<SalesAndPurchaseMod>" +
        "<IncomeAccountRef><ListID>80000030-333</ListID></IncomeAccountRef>" +
        "<ExpenseAccountRef><FullName>Cost of Goods Sold</FullName></ExpenseAccountRef>" +
        "</SalesAndPurchaseMod>" +
        "</ItemNonInventoryMod></ItemNonInventoryModRq>"
    );
  });

  it("buildQueryRq queries by FullName", () => {
    expect(
      item.buildQueryRq({ requestID: "op-item-q1", fullName: "WIDGET-100" })
    ).toBe(
      '<ItemNonInventoryQueryRq requestID="op-item-q1"><FullName>WIDGET-100</FullName></ItemNonInventoryQueryRq>'
    );
  });

  it("caps item names at 31 characters per level", () => {
    expect(() =>
      item.buildAddRq({
        requestID: "op-x",
        item: { name: "x".repeat(QBD_ITEM_NAME_MAX_LENGTH), ...accountRefs }
      })
    ).not.toThrow();

    const error = catchValidationError(() =>
      item.buildAddRq({
        requestID: "op-x",
        item: { name: "x".repeat(QBD_ITEM_NAME_MAX_LENGTH + 1), ...accountRefs }
      })
    );
    expect(error.failure.errorCode).toBe("NAME_TOO_LONG");
    expect(error.failure.metadata?.maxLength).toBe(31);

    const secondLevel = catchValidationError(() =>
      item.buildAddRq({
        requestID: "op-x",
        item: { name: `${"a".repeat(31)}:${"b".repeat(32)}`, ...accountRefs }
      })
    );
    expect(secondLevel.failure.errorCode).toBe("NAME_TOO_LONG");
  });

  it("throws UNMAPPED_ACCOUNTS when an account ref has no ListID or FullName", () => {
    const error = catchValidationError(() =>
      item.buildAddRq({
        requestID: "op-x",
        item: {
          name: "WIDGET-100",
          incomeAccountRef: {},
          expenseAccountRef: { listId: "80000040-444" }
        }
      })
    );
    expect(error.failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(error.failure.warning).toBe(true);
    expect(error.failure.message).toContain("income account");
  });

  it("parseRet reads an ItemNonInventoryRet", () => {
    const ret = item.parseRet({
      ListID: "80000050-555",
      EditSequence: "1622990000",
      Name: "WIDGET-100",
      FullName: "WIDGET-100"
    });
    expect(ret).toMatchObject({
      listId: "80000050-555",
      editSequence: "1622990000",
      fullName: "WIDGET-100"
    });
  });
});

// =====================================================================
// Invoice
// =====================================================================

describe("invoice builders", () => {
  it("buildAddRq golden snapshot (RefNumber fits, Memo stamped)", () => {
    expect(
      invoice.buildAddRq({
        requestID: "op-inv-1",
        invoice: {
          customerRef: { listId: "80000001-1234567890" },
          txnDate: "2026-07-09",
          dueDate: "2026-08-08",
          readableId: "SI000042",
          entityId: "slsinv_9f3k2m",
          lines: [
            {
              itemRef: { listId: "80000050-555" },
              description: "Widget, anodized",
              quantity: 20,
              rate: 25,
              amount: 500
            }
          ]
        }
      })
    ).toBe(
      '<InvoiceAddRq requestID="op-inv-1"><InvoiceAdd>' +
        "<CustomerRef><ListID>80000001-1234567890</ListID></CustomerRef>" +
        "<TxnDate>2026-07-09</TxnDate>" +
        "<RefNumber>SI000042</RefNumber>" +
        "<DueDate>2026-08-08</DueDate>" +
        "<Memo>Carbon SI000042 slsinv_9f3k2m</Memo>" +
        "<InvoiceLineAdd><ItemRef><ListID>80000050-555</ListID></ItemRef><Desc>Widget, anodized</Desc><Quantity>20</Quantity><Rate>25.00</Rate><Amount>500.00</Amount></InvoiceLineAdd>" +
        "</InvoiceAdd></InvoiceAddRq>"
    );
  });

  it("omits RefNumber when the readable id exceeds 11 chars — the id then lives ONLY in Memo", () => {
    const readableId = "INV-2026-000123";
    expect(readableId.length).toBeGreaterThan(QBD_REF_NUMBER_MAX_LENGTH);

    const xml = invoice.buildAddRq({
      requestID: "op-inv-2",
      invoice: {
        customerRef: { listId: "80000001-1" },
        txnDate: "2026-07-09",
        readableId,
        entityId: "slsinv_x1",
        lines: [{ description: "Line", amount: 10 }]
      }
    });

    expect(xml).not.toContain("<RefNumber>");
    expect(xml).toContain("<Memo>Carbon INV-2026-000123 slsinv_x1</Memo>");
  });

  it("prefers ListID over FullName on refs; falls back to FullName pre-resolution", () => {
    const both = invoice.buildAddRq({
      requestID: "op-inv-3",
      invoice: {
        customerRef: { listId: "80000001-1", fullName: "Acme Manufacturing" },
        txnDate: "2026-07-09",
        readableId: "SI1",
        entityId: "slsinv_y2",
        lines: [{ description: "Line", amount: 10 }]
      }
    });
    expect(both).toContain(
      "<CustomerRef><ListID>80000001-1</ListID></CustomerRef>"
    );
    expect(both).not.toContain("FullName");

    const fallback = invoice.buildAddRq({
      requestID: "op-inv-4",
      invoice: {
        customerRef: { fullName: "Acme Manufacturing" },
        txnDate: "2026-07-09",
        readableId: "SI2",
        entityId: "slsinv_z3",
        lines: [{ description: "Line", amount: 10 }]
      }
    });
    expect(fallback).toContain(
      "<CustomerRef><FullName>Acme Manufacturing</FullName></CustomerRef>"
    );
  });

  it("throws a plain Error (not a validation Warning) for an unresolved customer ref", () => {
    let thrown: unknown;
    try {
      invoice.buildAddRq({
        requestID: "op-inv-5",
        invoice: {
          customerRef: {},
          txnDate: "2026-07-09",
          readableId: "SI3",
          entityId: "slsinv_w4",
          lines: [{ description: "Line", amount: 10 }]
        }
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(QbxmlValidationError);
    expect((thrown as Error).message).toContain("CustomerRef");
  });

  it("buildQueryRq by RefNumber, or by TxnDate range for the memo-scan fallback — exactly one mode", () => {
    expect(
      invoice.buildQueryRq({ requestID: "op-inv-q1", refNumber: "SI000042" })
    ).toBe(
      '<InvoiceQueryRq requestID="op-inv-q1"><RefNumber>SI000042</RefNumber></InvoiceQueryRq>'
    );

    expect(
      invoice.buildQueryRq({
        requestID: "op-inv-q2",
        txnDateFrom: "2026-07-01",
        txnDateTo: "2026-07-09"
      })
    ).toBe(
      '<InvoiceQueryRq requestID="op-inv-q2"><TxnDateRangeFilter><FromTxnDate>2026-07-01</FromTxnDate><ToTxnDate>2026-07-09</ToTxnDate></TxnDateRangeFilter></InvoiceQueryRq>'
    );

    expect(() => invoice.buildQueryRq({ requestID: "op-inv-q3" })).toThrow(
      /exactly one filter/
    );
    expect(() =>
      invoice.buildQueryRq({
        requestID: "op-inv-q4",
        refNumber: "SI1",
        txnDateFrom: "2026-07-01"
      })
    ).toThrow(/exactly one filter/);
    expect(() =>
      invoice.buildQueryRq({
        requestID: "op-inv-q5",
        refNumber: "x".repeat(12)
      })
    ).toThrow(/use fitRefNumber/);
  });

  it("parseRet extracts TxnID/EditSequence/RefNumber/Memo from an InvoiceRet", () => {
    const responses = parseMessageSetResponse(
      fixture("invoice-add-response.xml")
    );
    const ret = invoice.parseRet(responses[0]!.payload);

    expect(ret).toMatchObject({
      txnId: "5D21-1622994339",
      editSequence: "1622994339",
      refNumber: "SI000042",
      memo: "Carbon SI000042 slsinv_9f3k2m"
    });
    expect(
      (ret?.fields.CustomerRef as Record<string, unknown> | undefined)?.ListID
    ).toBe("80000001-1234567890");
  });
});

// =====================================================================
// Bill
// =====================================================================

describe("bill builders", () => {
  it("buildAddRq golden snapshot — DueDate precedes RefNumber on BillAdd, expense lines before item lines", () => {
    expect(
      bill.buildAddRq({
        requestID: "op-bill-1",
        bill: {
          vendorRef: { listId: "80000009-999" },
          txnDate: "2026-07-09",
          dueDate: "2026-08-08",
          readableId: "B-1042",
          entityId: "pinv_7q2w",
          expenseLines: [
            {
              accountRef: { listId: "80000060-666" },
              amount: 120.5,
              memo: "Freight-in"
            }
          ],
          itemLines: [
            {
              itemRef: { listId: "80000050-555" },
              description: "Widget raw",
              quantity: 10,
              cost: 10.5,
              amount: 105
            }
          ]
        }
      })
    ).toBe(
      '<BillAddRq requestID="op-bill-1"><BillAdd>' +
        "<VendorRef><ListID>80000009-999</ListID></VendorRef>" +
        "<TxnDate>2026-07-09</TxnDate>" +
        "<DueDate>2026-08-08</DueDate>" +
        "<RefNumber>B-1042</RefNumber>" +
        "<Memo>Carbon B-1042 pinv_7q2w</Memo>" +
        "<ExpenseLineAdd><AccountRef><ListID>80000060-666</ListID></AccountRef><Amount>120.50</Amount><Memo>Freight-in</Memo></ExpenseLineAdd>" +
        "<ItemLineAdd><ItemRef><ListID>80000050-555</ListID></ItemRef><Desc>Widget raw</Desc><Quantity>10</Quantity><Cost>10.50</Cost><Amount>105.00</Amount></ItemLineAdd>" +
        "</BillAdd></BillAddRq>"
    );
  });

  it("requires at least one line", () => {
    expect(() =>
      bill.buildAddRq({
        requestID: "op-bill-2",
        bill: {
          vendorRef: { listId: "80000009-999" },
          txnDate: "2026-07-09",
          readableId: "B-1",
          entityId: "pinv_1"
        }
      })
    ).toThrow(/at least one expense or item line/);
  });

  it("throws UNMAPPED_ACCOUNTS for an expense line without a mapped account", () => {
    const error = catchValidationError(() =>
      bill.buildAddRq({
        requestID: "op-bill-3",
        bill: {
          vendorRef: { listId: "80000009-999" },
          txnDate: "2026-07-09",
          readableId: "B-2",
          entityId: "pinv_2",
          expenseLines: [{ accountRef: {}, amount: 10 }]
        }
      })
    );
    expect(error.failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(error.failure.warning).toBe(true);
  });

  it("buildQueryRq + parseRet round-trip shape", () => {
    expect(
      bill.buildQueryRq({ requestID: "op-bill-q1", refNumber: "B-1042" })
    ).toBe(
      '<BillQueryRq requestID="op-bill-q1"><RefNumber>B-1042</RefNumber></BillQueryRq>'
    );

    const ret = bill.parseRet({
      TxnID: "6E31-1700000000",
      EditSequence: "1700000000",
      RefNumber: "B-1042",
      Memo: "Carbon B-1042 pinv_7q2w"
    });
    expect(ret).toMatchObject({
      txnId: "6E31-1700000000",
      editSequence: "1700000000",
      refNumber: "B-1042",
      memo: "Carbon B-1042 pinv_7q2w"
    });
  });
});

// =====================================================================
// Purchase order
// =====================================================================

describe("purchase-order builders", () => {
  it("buildAddRq golden snapshot (RefNumber after TxnDate, ExpectedDate before Memo)", () => {
    expect(
      purchaseOrder.buildAddRq({
        requestID: "op-po-1",
        purchaseOrder: {
          vendorRef: { listId: "80000009-999" },
          txnDate: "2026-07-09",
          expectedDate: "2026-07-20",
          readableId: "PO000077",
          entityId: "po_5t6y",
          lines: [
            {
              itemRef: { listId: "80000050-555" },
              description: "Widget raw",
              quantity: 100,
              rate: 10.5,
              amount: 1050
            }
          ]
        }
      })
    ).toBe(
      '<PurchaseOrderAddRq requestID="op-po-1"><PurchaseOrderAdd>' +
        "<VendorRef><ListID>80000009-999</ListID></VendorRef>" +
        "<TxnDate>2026-07-09</TxnDate>" +
        "<RefNumber>PO000077</RefNumber>" +
        "<ExpectedDate>2026-07-20</ExpectedDate>" +
        "<Memo>Carbon PO000077 po_5t6y</Memo>" +
        "<PurchaseOrderLineAdd><ItemRef><ListID>80000050-555</ListID></ItemRef><Desc>Widget raw</Desc><Quantity>100</Quantity><Rate>10.50</Rate><Amount>1050.00</Amount></PurchaseOrderLineAdd>" +
        "</PurchaseOrderAdd></PurchaseOrderAddRq>"
    );
  });

  it("buildQueryRq by date range + parseRet shape", () => {
    expect(
      purchaseOrder.buildQueryRq({
        requestID: "op-po-q1",
        txnDateFrom: "2026-07-01"
      })
    ).toBe(
      '<PurchaseOrderQueryRq requestID="op-po-q1"><TxnDateRangeFilter><FromTxnDate>2026-07-01</FromTxnDate></TxnDateRangeFilter></PurchaseOrderQueryRq>'
    );

    const ret = purchaseOrder.parseRet({
      TxnID: "7F41-1700000001",
      EditSequence: "1700000001",
      RefNumber: "PO000077"
    });
    expect(ret?.txnId).toBe("7F41-1700000001");
    expect(ret?.memo).toBeNull();
  });
});

// =====================================================================
// Journal entry
// =====================================================================

describe("journal-entry builders", () => {
  it("buildAddRq golden snapshot: Carbon sign split (positive = debit), abs 2dp amounts, first line carries the stamp", () => {
    expect(
      journalEntry.buildAddRq({
        requestID: "op-je-1",
        journalEntry: {
          journalEntryId: "JE000123",
          entityId: "jrnl_abc123",
          postingDate: "2026-07-09",
          lines: [
            {
              accountRef: { listId: "80000010-111" },
              amount: 125.5,
              description: "Inventory receipt"
            },
            { accountRef: { listId: "80000020-222" }, amount: -125.5 }
          ]
        }
      })
    ).toBe(
      '<JournalEntryAddRq requestID="op-je-1"><JournalEntryAdd>' +
        "<TxnDate>2026-07-09</TxnDate>" +
        "<RefNumber>JE000123</RefNumber>" +
        "<JournalDebitLine><AccountRef><ListID>80000010-111</ListID></AccountRef><Amount>125.50</Amount><Memo>Carbon JE000123 jrnl_abc123 | Inventory receipt</Memo></JournalDebitLine>" +
        "<JournalCreditLine><AccountRef><ListID>80000020-222</ListID></AccountRef><Amount>125.50</Amount><Memo>Carbon JE000123 jrnl_abc123</Memo></JournalCreditLine>" +
        "</JournalEntryAdd></JournalEntryAddRq>"
    );
  });

  it("splits mixed multi-line journals by sign and keeps line order", () => {
    const xml = journalEntry.buildAddRq({
      requestID: "op-je-2",
      journalEntry: {
        journalEntryId: "JE000124",
        entityId: "jrnl_def456",
        postingDate: "2026-07-09",
        lines: [
          { accountRef: { listId: "A-1" }, amount: -30, description: "WIP" },
          { accountRef: { listId: "A-2" }, amount: 10.004 },
          { accountRef: { listId: "A-3" }, amount: 19.996 }
        ]
      }
    });

    // First line is a credit and still carries the Carbon stamp merged with
    // its description
    expect(xml).toContain(
      "<JournalCreditLine><AccountRef><ListID>A-1</ListID></AccountRef><Amount>30.00</Amount><Memo>Carbon JE000124 jrnl_def456 | WIP</Memo></JournalCreditLine>"
    );
    // 10.004 and 19.996 round to 2dp consistently with the balance check
    expect(xml).toContain("<Amount>10.00</Amount>");
    expect(xml).toContain("<Amount>20.00</Amount>");
    expect(
      xml.indexOf("JournalCreditLine") < xml.indexOf("JournalDebitLine")
    ).toBe(true);
  });

  it("throws the structured UNBALANCED_JOURNAL failure (warning: false) when debits != credits", () => {
    const error = catchValidationError(() =>
      journalEntry.buildAddRq({
        requestID: "op-je-3",
        journalEntry: {
          journalEntryId: "JE000125",
          entityId: "jrnl_ghi789",
          postingDate: "2026-07-09",
          lines: [
            { accountRef: { listId: "A-1" }, amount: 100 },
            { accountRef: { listId: "A-2" }, amount: -99.99 }
          ]
        }
      })
    );

    expect(error.failure.errorCode).toBe("UNBALANCED_JOURNAL");
    expect(error.failure.warning).toBe(false);
    expect(error.failure.message).toContain("100.00");
    expect(error.failure.message).toContain("99.99");
    expect(isJournalEntrySyncFailure(error.failure)).toBe(true);
  });

  it("omits RefNumber for a readable id over 11 chars (the id stays in the line memos)", () => {
    const xml = journalEntry.buildAddRq({
      requestID: "op-je-4",
      journalEntry: {
        journalEntryId: "JE-2026-000123",
        entityId: "jrnl_long1",
        postingDate: "2026-07-09",
        lines: [
          { accountRef: { listId: "A-1" }, amount: 5 },
          { accountRef: { listId: "A-2" }, amount: -5 }
        ]
      }
    });

    expect(xml).not.toContain("<RefNumber>");
    expect(xml).toContain("<Memo>Carbon JE-2026-000123 jrnl_long1</Memo>");
  });

  it("throws UNMAPPED_ACCOUNTS for a line without a mapped account", () => {
    const error = catchValidationError(() =>
      journalEntry.buildAddRq({
        requestID: "op-je-5",
        journalEntry: {
          journalEntryId: "JE000126",
          entityId: "jrnl_jkl012",
          postingDate: "2026-07-09",
          lines: [
            { accountRef: {}, amount: 10 },
            { accountRef: { listId: "A-2" }, amount: -10 }
          ]
        }
      })
    );
    expect(error.failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(error.failure.warning).toBe(true);
  });

  it("rejects an empty journal", () => {
    expect(() =>
      journalEntry.buildAddRq({
        requestID: "op-je-6",
        journalEntry: {
          journalEntryId: "JE000127",
          entityId: "jrnl_mno345",
          postingDate: "2026-07-09",
          lines: []
        }
      })
    ).toThrow(/no lines/);
  });

  it("buildQueryRq by RefNumber + parseRet on a JournalEntryRet", () => {
    expect(
      journalEntry.buildQueryRq({
        requestID: "op-je-q1",
        refNumber: "JE000123"
      })
    ).toBe(
      '<JournalEntryQueryRq requestID="op-je-q1"><RefNumber>JE000123</RefNumber></JournalEntryQueryRq>'
    );

    const ret = journalEntry.parseRet({
      TxnID: "8A51-1700000002",
      EditSequence: "1700000002",
      RefNumber: "JE000123"
    });
    expect(ret).toMatchObject({
      txnId: "8A51-1700000002",
      editSequence: "1700000002",
      refNumber: "JE000123"
    });
  });
});

// =====================================================================
// Shared helpers + escaping
// =====================================================================

describe("shared helpers", () => {
  it("fitRefNumber keeps ids up to 11 chars and drops longer ones", () => {
    expect(fitRefNumber("12345678901")).toBe("12345678901");
    expect(fitRefNumber("123456789012")).toBeUndefined();
    expect(fitRefNumber("")).toBeUndefined();
  });

  it("buildCarbonMemo stamps the readable id and the Carbon entity id", () => {
    expect(buildCarbonMemo("SI000042", "slsinv_9f3k2m")).toBe(
      "Carbon SI000042 slsinv_9f3k2m"
    );
  });
});

describe("XML escaping of user text", () => {
  const name = `R&D <"Tools"> 'Co'`;

  it("escapes &, <, >, \" and ' in built requests", () => {
    const xml = customer.buildAddRq({
      requestID: "op-esc-1",
      customer: { name }
    });
    expect(xml).toContain(
      "<Name>R&amp;D &lt;&quot;Tools&quot;&gt; &apos;Co&apos;</Name>"
    );
  });

  it("round-trips escaped text through parseMessageSetResponse + parseRet", () => {
    const responseXml =
      '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>' +
      '<CustomerAddRs requestID="op-esc-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK">' +
      `<CustomerRet><ListID>80000099-1</ListID><EditSequence>1</EditSequence><Name>${xmlEscape(
        name
      )}</Name><FullName>${xmlEscape(name)}</FullName></CustomerRet>` +
      "</CustomerAddRs></QBXMLMsgsRs></QBXML>";

    const responses = parseMessageSetResponse(responseXml);
    const ret = customer.parseRet(responses[0]!.payload);
    expect(ret?.fullName).toBe(name);
    expect(ret?.name).toBe(name);
  });

  it("escapes memo text on transactions", () => {
    const xml = invoice.buildAddRq({
      requestID: "op-esc-2",
      invoice: {
        customerRef: { listId: "80000001-1" },
        txnDate: "2026-07-09",
        readableId: "S&I<1>",
        entityId: "slsinv_'esc'",
        lines: [{ description: "Line", amount: 10 }]
      }
    });
    expect(xml).toContain(
      "<Memo>Carbon S&amp;I&lt;1&gt; slsinv_&apos;esc&apos;</Memo>"
    );
  });
});
