import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

import {
  getSalesOrderInvoiceLines,
  getSalesOrderInvoicesByIds
} from "../sales/sales.service";
import {
  getPurchaseOrderInvoiceLines,
  getPurchaseOrderInvoicesByIds
} from "./invoicing.service";

type QueryCall = {
  table: string;
  select?: string;
  filters: { operator: string; column: string; value: unknown }[];
};

function makeClient() {
  const calls: QueryCall[] = [];

  const client = {
    from(table: string) {
      const call: QueryCall = { table, filters: [] };
      calls.push(call);

      const builder = {
        select(columns: string) {
          call.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push({ operator: "eq", column, value });
          return builder;
        },
        in(column: string, value: unknown[]) {
          call.filters.push({ operator: "in", column, value });
          return builder;
        },
        then(
          onFulfilled: (value: { data: never[]; error: null }) => unknown,
          onRejected?: (error: unknown) => unknown
        ) {
          return Promise.resolve({ data: [], error: null }).then(
            onFulfilled,
            onRejected
          );
        }
      };

      return builder;
    }
  };

  return { client: client as never, calls };
}

function expectCompanyScope(call: QueryCall, companyId: string) {
  expect(call.filters).toContainEqual({
    operator: "eq",
    column: "companyId",
    value: companyId
  });
}

describe("invoice settlement queries", () => {
  it("company-scopes Sales Order invoice-line linkage", async () => {
    const { client, calls } = makeClient();

    await getSalesOrderInvoiceLines(client, "company-1", "order-1");

    expect(calls[0]).toMatchObject({
      table: "salesInvoiceLine",
      select: "invoiceId"
    });
    expectCompanyScope(calls[0], "company-1");
    expect(calls[0].filters).toContainEqual({
      operator: "eq",
      column: "salesOrderId",
      value: "order-1"
    });
  });

  it("company-scopes the batched Sales Order invoice view read", async () => {
    const { client, calls } = makeClient();

    await getSalesOrderInvoicesByIds(client, "company-1", ["invoice-1"]);

    expect(calls[0]).toMatchObject({
      table: "salesInvoices",
      select: "id, totalAmount, balance, currencyCode, exchangeRate"
    });
    expectCompanyScope(calls[0], "company-1");
    expect(calls[0].filters).toContainEqual({
      operator: "in",
      column: "id",
      value: ["invoice-1"]
    });
  });

  it("company-scopes Purchase Order invoice-line linkage", async () => {
    const { client, calls } = makeClient();

    await getPurchaseOrderInvoiceLines(client, "company-1", "order-1");

    expect(calls[0]).toMatchObject({
      table: "purchaseInvoiceLine",
      select: "invoiceId"
    });
    expectCompanyScope(calls[0], "company-1");
    expect(calls[0].filters).toContainEqual({
      operator: "eq",
      column: "purchaseOrderId",
      value: "order-1"
    });
  });

  it("company-scopes the batched Purchase Order invoice view read", async () => {
    const { client, calls } = makeClient();

    await getPurchaseOrderInvoicesByIds(client, "company-1", ["invoice-1"]);

    expect(calls[0]).toMatchObject({
      table: "purchaseInvoices",
      select: "id, totalAmount, balance, currencyCode, exchangeRate"
    });
    expectCompanyScope(calls[0], "company-1");
    expect(calls[0].filters).toContainEqual({
      operator: "in",
      column: "id",
      value: ["invoice-1"]
    });
  });
});
