import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./$orderId";

const mocks = vi.hoisted(() => ({
  requirePermissions: vi.fn(),
  getCarbonServiceRole: vi.fn(),
  flash: vi.fn(),
  error: vi.fn(),
  getCustomer: vi.fn(),
  getOpportunity: vi.fn(),
  getOpportunityDocuments: vi.fn(),
  getQuote: vi.fn(),
  getSalesOrder: vi.fn(),
  getSalesOrderInvoiceLines: vi.fn(),
  getSalesOrderInvoicesByIds: vi.fn(),
  getSalesOrderLines: vi.fn(),
  getSalesOrderRelatedItems: vi.fn(),
  getCompanySettings: vi.fn()
}));

vi.mock("@carbon/auth", () => ({
  error: mocks.error
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: mocks.requirePermissions
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: mocks.getCarbonServiceRole
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: mocks.flash
}));
vi.mock("@carbon/react", () => ({
  VStack: () => null
}));
vi.mock("@lingui/core/macro", () => ({
  msg: (value: unknown) => value
}));
vi.mock("~/components/Layout/Panels", () => ({
  PanelProvider: () => null,
  ResizablePanels: () => null
}));
vi.mock("~/modules/sales", () => ({
  getCustomer: mocks.getCustomer,
  getOpportunity: mocks.getOpportunity,
  getOpportunityDocuments: mocks.getOpportunityDocuments,
  getQuote: mocks.getQuote,
  getSalesOrder: mocks.getSalesOrder,
  getSalesOrderInvoiceLines: mocks.getSalesOrderInvoiceLines,
  getSalesOrderInvoicesByIds: mocks.getSalesOrderInvoicesByIds,
  getSalesOrderLines: mocks.getSalesOrderLines,
  getSalesOrderRelatedItems: mocks.getSalesOrderRelatedItems
}));
vi.mock("~/modules/sales/ui/SalesOrder", () => ({
  SalesOrderExplorer: () => null,
  SalesOrderHeader: () => null,
  SalesOrderProperties: () => null
}));
vi.mock("~/modules/settings", () => ({
  getCompanySettings: mocks.getCompanySettings
}));
vi.mock("~/utils/handle", () => ({
  detailBreadcrumb: vi.fn(() => ({}))
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      items: "/x/items",
      salesOrder: (id: string) => `/x/sales-order/${id}`,
      salesOrders: "/x/sales-orders"
    }
  }
}));
vi.mock("~/modules/invoicing", async () => {
  const utils = await import("~/modules/invoicing/invoicing.utils");
  return utils;
});

type InvoiceRow = {
  id: string | null;
  totalAmount: number | null;
  balance: number | null;
  currencyCode: string | null;
  exchangeRate: number | null;
};

const client = { name: "client" };
const order = {
  id: "order-1",
  salesOrderId: "SO-0001",
  companyId: "company-1",
  opportunityId: "opportunity-1",
  customerId: "customer-1",
  currencyCode: "USD",
  status: "To Invoice",
  shippingCost: 0,
  exchangeRate: 0.8
};

beforeEach(() => {
  vi.resetAllMocks();

  mocks.requirePermissions.mockResolvedValue({
    client,
    companyId: "company-1"
  });
  mocks.getCarbonServiceRole.mockReturnValue({ name: "service-role" });
  mocks.flash.mockImplementation(async (_request, value) => value);
  mocks.error.mockImplementation((cause, message) => ({ cause, message }));
  mocks.getSalesOrder.mockResolvedValue({ data: order, error: null });
  mocks.getSalesOrderLines.mockResolvedValue({ data: [], error: null });
  mocks.getOpportunity.mockResolvedValue({
    data: { id: "opportunity-1", quotes: [] },
    error: null
  });
  mocks.getCustomer.mockResolvedValue({
    data: { defaultCc: [] },
    error: null
  });
  mocks.getCompanySettings.mockResolvedValue({
    data: { defaultCustomerCc: [] },
    error: null
  });
  mocks.getOpportunityDocuments.mockResolvedValue([]);
  mocks.getSalesOrderRelatedItems.mockResolvedValue({
    jobs: [],
    shipments: [],
    invoices: []
  });
  mocks.getSalesOrderInvoiceLines.mockResolvedValue({
    data: [{ invoiceId: "invoice-1" }, { invoiceId: "invoice-1" }],
    error: null
  });
  mocks.getSalesOrderInvoicesByIds.mockResolvedValue({
    data: [
      {
        id: "invoice-1",
        totalAmount: 1000,
        balance: 750,
        currencyCode: "USD",
        exchangeRate: 0.9
      } satisfies InvoiceRow
    ],
    error: null
  });
});

function loadSalesOrder() {
  return loader({
    request: new Request("http://localhost/x/sales-order/order-1"),
    params: { orderId: "order-1" }
  } as never);
}

describe("Sales Order settlement loader", () => {
  it("uses the linked invoice rate for the presentation settlement summary", async () => {
    const result = await loadSalesOrder();

    expect(mocks.getSalesOrderInvoiceLines).toHaveBeenCalledWith(
      client,
      "company-1",
      "order-1"
    );
    expect(mocks.getSalesOrderInvoicesByIds).toHaveBeenCalledWith(
      client,
      "company-1",
      ["invoice-1"]
    );
    expect(result.invoiceSummary).toMatchObject({
      invoicedAmount: 900,
      paidAmount: 225,
      balanceRemaining: 675,
      includedInvoiceCount: 1,
      currencyMismatchCount: 0,
      invalidExchangeRateCount: 0
    });
  });

  it("does not query or mark Paid when there are no linked invoices", async () => {
    mocks.getSalesOrderInvoiceLines.mockResolvedValue({
      data: [],
      error: null
    });

    const result = await loadSalesOrder();

    expect(mocks.getSalesOrderInvoicesByIds).not.toHaveBeenCalled();
    expect(result.invoiceSummary).toMatchObject({
      invoicedAmount: 0,
      paidAmount: 0,
      balanceRemaining: 0,
      includedInvoiceCount: 0
    });
  });

  it("excludes unresolved currency and invalid exchange-rate metadata", async () => {
    mocks.getSalesOrderInvoicesByIds.mockResolvedValue({
      data: [
        {
          id: "invoice-1",
          totalAmount: 250,
          balance: 0,
          currencyCode: null,
          exchangeRate: null
        },
        {
          id: "invoice-2",
          totalAmount: 100,
          balance: 0,
          currencyCode: "USD",
          exchangeRate: 0
        }
      ],
      error: null
    });
    mocks.getSalesOrderInvoiceLines.mockResolvedValue({
      data: [{ invoiceId: "invoice-1" }, { invoiceId: "invoice-2" }],
      error: null
    });

    const result = await loadSalesOrder();

    expect(result.invoiceSummary).toMatchObject({
      invoicedAmount: 0,
      paidAmount: 0,
      balanceRemaining: 0,
      includedInvoiceCount: 0,
      currencyMismatchCount: 1,
      invalidExchangeRateCount: 1
    });
  });

  it("redirects instead of understating totals when a linked batch row is missing", async () => {
    mocks.getSalesOrderInvoicesByIds.mockResolvedValue({
      data: [],
      error: null
    });

    await expect(loadSalesOrder()).rejects.toMatchObject({ status: 302 });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.any(Error),
      "Failed to load sales invoice totals"
    );
  });

  it("redirects instead of coercing a null authoritative balance to zero", async () => {
    mocks.getSalesOrderInvoicesByIds.mockResolvedValue({
      data: [
        {
          id: "invoice-1",
          totalAmount: 250,
          balance: null,
          currencyCode: "USD",
          exchangeRate: 1
        }
      ],
      error: null
    });

    await expect(loadSalesOrder()).rejects.toMatchObject({ status: 302 });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.any(Error),
      "Failed to load sales invoice totals"
    );
  });
});
