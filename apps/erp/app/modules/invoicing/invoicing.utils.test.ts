import { describe, expect, it } from "vitest";
import {
  getInvoicePresentationSettlement,
  getInvoiceSettlementSummary,
  getInvoiceSettlementValues,
  getMissingInvoiceIds,
  type InvoiceSettlementRow,
  isInvoiceSettlementSettled
} from "./invoicing.utils";

function invoice(
  id: string,
  totalAmount: number,
  balance: number,
  overrides: Partial<InvoiceSettlementRow> = {}
): InvoiceSettlementRow {
  return {
    id,
    totalAmount,
    balance,
    currencyCode: "USD",
    exchangeRate: 1,
    ...overrides
  };
}

function summarize(
  invoices: readonly InvoiceSettlementRow[],
  options: Partial<Parameters<typeof getInvoiceSettlementSummary>[1]> = {}
) {
  return getInvoiceSettlementSummary(invoices, {
    targetCurrency: "USD",
    ...options
  });
}

describe("getInvoiceSettlementSummary", () => {
  it("derives zero paid for an unpaid invoice", () => {
    const summary = summarize([invoice("i1", 1000, 1000)]);

    expect(summary).toEqual({
      totalAmount: 1000,
      amountPaid: 0,
      balanceRemaining: 1000,
      includedInvoiceCount: 1,
      currencyMismatchCount: 0,
      invalidExchangeRateCount: 0
    });
    expect(isInvoiceSettlementSettled(summary)).toBe(false);
  });

  it("derives a partial payment from total minus balance", () => {
    const summary = summarize([invoice("i1", 1000, 750)]);

    expect(summary.amountPaid).toBe(250);
    expect(summary.balanceRemaining).toBe(750);
  });

  it("derives the full paid amount and settled state", () => {
    const summary = summarize([invoice("i1", 1000, 0)]);

    expect(summary.amountPaid).toBe(1000);
    expect(isInvoiceSettlementSettled(summary)).toBe(true);
  });

  it("does not mark a settled valid invoice as Paid when a linked invoice has mismatched currency", () => {
    const summary = summarize([
      invoice("i1", 1000, 0),
      invoice("i2", 500, 0, { currencyCode: "EUR" })
    ]);

    expect(summary).toMatchObject({
      totalAmount: 1000,
      balanceRemaining: 0,
      includedInvoiceCount: 1,
      currencyMismatchCount: 1
    });
    expect(isInvoiceSettlementSettled(summary)).toBe(false);
  });

  it("does not mark a settled valid invoice as Paid when a linked invoice has an invalid rate", () => {
    const summary = summarize([
      invoice("i1", 1000, 0),
      invoice("i2", 500, 0, { exchangeRate: 0 })
    ]);

    expect(summary).toMatchObject({
      totalAmount: 1000,
      balanceRemaining: 0,
      includedInvoiceCount: 1,
      invalidExchangeRateCount: 1
    });
    expect(isInvoiceSettlementSettled(summary)).toBe(false);
  });

  it("marks all valid, fully settled positive invoices as Paid", () => {
    const summary = summarize([invoice("i1", 1000, 0), invoice("i2", 500, 0)]);

    expect(summary).toMatchObject({
      totalAmount: 1500,
      balanceRemaining: 0,
      includedInvoiceCount: 2,
      currencyMismatchCount: 0,
      invalidExchangeRateCount: 0
    });
    expect(isInvoiceSettlementSettled(summary)).toBe(true);
  });

  it("aggregates unpaid, partially paid, and fully paid invoices", () => {
    const summary = summarize([
      invoice("i1", 1000, 1000),
      invoice("i2", 1000, 750),
      invoice("i3", 1000, 0)
    ]);

    expect(summary).toMatchObject({
      totalAmount: 3000,
      amountPaid: 1250,
      balanceRemaining: 1750,
      includedInvoiceCount: 3
    });
  });

  it("does not double-count duplicate invoice ids", () => {
    const summary = summarize([
      invoice("i1", 1000, 750),
      invoice("i1", 1000, 750)
    ]);

    expect(summary).toMatchObject({
      totalAmount: 1000,
      amountPaid: 250,
      balanceRemaining: 750,
      includedInvoiceCount: 1
    });
  });

  it("excludes mismatched currencies without mixing their amounts", () => {
    const summary = getInvoiceSettlementSummary(
      [
        invoice("i1", 1000, 750, { currencyCode: "USD" }),
        invoice("i2", 500, 0, { currencyCode: "EUR" })
      ],
      { targetCurrency: "USD", convertToTarget: true }
    );

    expect(summary).toMatchObject({
      totalAmount: 1000,
      amountPaid: 250,
      balanceRemaining: 750,
      includedInvoiceCount: 1,
      currencyMismatchCount: 1
    });
  });

  it("excludes invoices with missing currency metadata", () => {
    const summary = summarize([
      invoice("i1", 1000, 0),
      invoice("i2", 500, 0, { currencyCode: null })
    ]);

    expect(summary).toMatchObject({
      totalAmount: 1000,
      amountPaid: 1000,
      balanceRemaining: 0,
      includedInvoiceCount: 1,
      currencyMismatchCount: 1
    });
  });

  it("excludes every row when the target currency is unresolved", () => {
    const summary = getInvoiceSettlementSummary([invoice("i1", 1000, 0)], {
      targetCurrency: null,
      convertToTarget: true
    });

    expect(summary).toMatchObject({
      totalAmount: 0,
      amountPaid: 0,
      balanceRemaining: 0,
      includedInvoiceCount: 0,
      currencyMismatchCount: 1
    });
  });

  it("converts with each invoice's exchange rate instead of a parent rate", () => {
    const summary = getInvoiceSettlementSummary(
      [
        invoice("i1", 1000, 750, {
          currencyCode: "EUR",
          exchangeRate: 1.25
        }),
        invoice("i2", 200, 100, {
          currencyCode: "EUR",
          exchangeRate: 1.1
        })
      ],
      { targetCurrency: "EUR", convertToTarget: true }
    );

    expect(summary).toMatchObject({
      totalAmount: 1470,
      amountPaid: 422.5,
      balanceRemaining: 1047.5
    });
  });

  it.each([
    ["null", null],
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY]
  ])("excludes a %s exchange rate from converted settlement", (_label, rate) => {
    const summary = summarize(
      [invoice("i1", 1000, 0, { exchangeRate: rate })],
      { convertToTarget: true }
    );

    expect(summary).toMatchObject({
      totalAmount: 0,
      amountPaid: 0,
      balanceRemaining: 0,
      includedInvoiceCount: 0,
      invalidExchangeRateCount: 1
    });
    expect(isInvoiceSettlementSettled(summary)).toBe(false);
  });

  it("uses a valid positive exchange rate for converted settlement", () => {
    const summary = summarize(
      [invoice("i1", 400, 100, { exchangeRate: 1.5 })],
      { convertToTarget: true }
    );

    expect(summary).toMatchObject({
      totalAmount: 600,
      amountPaid: 450,
      balanceRemaining: 150,
      includedInvoiceCount: 1,
      invalidExchangeRateCount: 0
    });
  });

  it("applies the same aggregation semantics to purchase invoices", () => {
    const summary = getInvoiceSettlementSummary(
      [
        invoice("pi1", 400, 400, {
          currencyCode: "GBP",
          exchangeRate: 1.4
        }),
        invoice("pi2", 600, 150, {
          currencyCode: "GBP",
          exchangeRate: 1.2
        })
      ],
      {
        targetCurrency: "GBP",
        convertToTarget: true
      }
    );

    expect(summary).toMatchObject({
      totalAmount: 1280,
      amountPaid: 540,
      balanceRemaining: 740,
      includedInvoiceCount: 2
    });
  });

  it("does not convert missing financial fields to zero", () => {
    expect(() =>
      summarize([invoice("i1", 1000, 0, { totalAmount: null })])
    ).toThrow("invalid settlement totals");
    expect(() =>
      summarize([invoice("i1", 1000, 0, { balance: null })])
    ).toThrow("invalid settlement totals");
  });

  it("uses total minus balance for non-cash settlement such as a write-off", () => {
    const summary = summarize([invoice("i1", 1000, 650)]);

    expect(summary.amountPaid).toBe(350);
  });

  it("does not treat a zero-value linked invoice as paid", () => {
    const summary = summarize([invoice("i1", 0, 0)]);

    expect(isInvoiceSettlementSettled(summary)).toBe(false);
  });

  it("does not treat a nonzero tiny balance as paid by display rounding", () => {
    const summary = summarize([invoice("i1", 1000, 0.004)]);

    expect(isInvoiceSettlementSettled(summary)).toBe(false);
  });

  it("does not treat an empty linked-invoice set as paid", () => {
    const summary = summarize([]);

    expect(summary).toEqual({
      totalAmount: 0,
      amountPaid: 0,
      balanceRemaining: 0,
      includedInvoiceCount: 0,
      currencyMismatchCount: 0,
      invalidExchangeRateCount: 0
    });
    expect(isInvoiceSettlementSettled(summary)).toBe(false);
  });
});

describe("individual invoice settlement", () => {
  it("uses the authoritative total and balance for detail settlement", () => {
    const settlement = getInvoiceSettlementValues(invoice("i1", 1000, 750));

    expect(settlement).toEqual({
      totalAmount: 1000,
      amountPaid: 250,
      balanceRemaining: 750
    });
  });

  it.each([
    ["null total", { totalAmount: null, balance: 750 }],
    ["null balance", { totalAmount: 1000, balance: null }],
    ["NaN total", { totalAmount: Number.NaN, balance: 750 }],
    [
      "infinite balance",
      { totalAmount: 1000, balance: Number.POSITIVE_INFINITY }
    ]
  ])("rejects malformed authoritative fields: %s", (_label, values) => {
    expect(() =>
      getInvoiceSettlementValues(invoice("i1", 1000, 750, values))
    ).toThrow("invalid settlement totals");
  });

  it("keeps authoritative settlement values when currency metadata is missing", () => {
    const invoiceRow = invoice("i1", 1000, 750, {
      currencyCode: null,
      exchangeRate: null
    });
    const settlement = getInvoiceSettlementValues(invoiceRow);

    expect(settlement).toEqual({
      totalAmount: 1000,
      amountPaid: 250,
      balanceRemaining: 750
    });
    expect(getInvoicePresentationSettlement(invoiceRow, settlement)).toBeNull();
  });

  it("keeps authoritative settlement values when the presentation rate is invalid", () => {
    const invoiceRow = invoice("i1", 1000, 750, { exchangeRate: 0 });
    const settlement = getInvoiceSettlementValues(invoiceRow);

    expect(settlement.amountPaid).toBe(250);
    expect(getInvoicePresentationSettlement(invoiceRow, settlement)).toBeNull();
  });

  it("converts only the optional presentation settlement with valid metadata", () => {
    const invoiceRow = invoice("i1", 1000, 750, {
      currencyCode: "EUR",
      exchangeRate: 0.9
    });
    const settlement = getInvoiceSettlementValues(invoiceRow);

    expect(getInvoicePresentationSettlement(invoiceRow, settlement)).toEqual({
      totalAmount: 900,
      amountPaid: 225,
      balanceRemaining: 675
    });
  });
});

describe("getMissingInvoiceIds", () => {
  it("reports expected invoice rows missing from a batch response", () => {
    expect(
      getMissingInvoiceIds(
        ["i1", "i2", "i2"],
        [{ id: "i1" }, { id: "unrelated" }, { id: null }]
      )
    ).toEqual(["i2"]);
  });

  it("returns no missing ids when every expected row is present", () => {
    expect(
      getMissingInvoiceIds(["i1", "i2"], [{ id: "i1" }, { id: "i2" }])
    ).toEqual([]);
  });
});
