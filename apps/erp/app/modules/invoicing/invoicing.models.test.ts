import { describe, expect, it } from "vitest";
import {
  paymentApplicationValidator,
  paymentValidator
} from "./invoicing.models";

describe("paymentValidator", () => {
  const validReceipt = {
    paymentType: "Receipt" as const,
    customerId: "cust1",
    paymentDate: "2026-05-19",
    currencyCode: "USD",
    exchangeRate: 1,
    totalAmount: 100,
    bankAccount: "acc1"
  };

  it("accepts a Receipt with a customer", () => {
    const r = paymentValidator.safeParse(validReceipt);
    expect(r.success).toBe(true);
  });

  it("accepts a Disbursement with a supplier", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      paymentType: "Disbursement",
      customerId: undefined,
      supplierId: "supp1"
    });
    expect(r.success).toBe(true);
  });

  it("rejects a Receipt missing customer", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      customerId: undefined
    });
    expect(r.success).toBe(false);
  });

  it("rejects a Disbursement missing supplier", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      paymentType: "Disbursement",
      customerId: undefined
    });
    expect(r.success).toBe(false);
  });

  it("rejects a zero totalAmount", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      totalAmount: 0
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative totalAmount", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      totalAmount: -10
    });
    expect(r.success).toBe(false);
  });

  it("rejects a zero exchange rate", () => {
    const r = paymentValidator.safeParse({
      ...validReceipt,
      exchangeRate: 0
    });
    expect(r.success).toBe(false);
  });
});

describe("paymentApplicationValidator", () => {
  const validApp = {
    paymentId: "p1",
    salesInvoiceId: "si1",
    appliedAmount: 50,
    discountAmount: 0,
    writeOffAmount: 0,
    invoiceExchangeRate: 1,
    paymentExchangeRate: 1,
    appliedDate: "2026-05-19"
  };

  it("accepts an application against a sales invoice", () => {
    const r = paymentApplicationValidator.safeParse(validApp);
    expect(r.success).toBe(true);
  });

  it("accepts an application against a purchase invoice", () => {
    const r = paymentApplicationValidator.safeParse({
      ...validApp,
      salesInvoiceId: undefined,
      purchaseInvoiceId: "pi1"
    });
    expect(r.success).toBe(true);
  });

  it("rejects when both sales and purchase ids set", () => {
    const r = paymentApplicationValidator.safeParse({
      ...validApp,
      purchaseInvoiceId: "pi1"
    });
    expect(r.success).toBe(false);
  });

  it("rejects when neither sales nor purchase id set", () => {
    const r = paymentApplicationValidator.safeParse({
      ...validApp,
      salesInvoiceId: undefined
    });
    expect(r.success).toBe(false);
  });

  it("rejects when all three components are zero", () => {
    const r = paymentApplicationValidator.safeParse({
      ...validApp,
      appliedAmount: 0,
      discountAmount: 0,
      writeOffAmount: 0
    });
    expect(r.success).toBe(false);
  });

  it("accepts a discount-only application (no cash applied)", () => {
    const r = paymentApplicationValidator.safeParse({
      ...validApp,
      appliedAmount: 0,
      discountAmount: 5
    });
    expect(r.success).toBe(true);
  });

  it("accepts a write-off-only application", () => {
    const r = paymentApplicationValidator.safeParse({
      ...validApp,
      appliedAmount: 0,
      writeOffAmount: 5
    });
    expect(r.success).toBe(true);
  });

  it("rejects a zero invoice exchange rate", () => {
    const r = paymentApplicationValidator.safeParse({
      ...validApp,
      invoiceExchangeRate: 0
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative payment exchange rate", () => {
    const r = paymentApplicationValidator.safeParse({
      ...validApp,
      paymentExchangeRate: -1
    });
    expect(r.success).toBe(false);
  });
});
