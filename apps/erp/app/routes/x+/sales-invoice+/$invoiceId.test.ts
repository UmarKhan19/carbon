import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermissions: vi.fn(),
  getCarbonServiceRole: vi.fn(),
  flash: vi.fn(),
  error: vi.fn(),
  getCurrencyByCode: vi.fn(),
  getCompanyHasOpenCredits: vi.fn(),
  getSalesInvoice: vi.fn(),
  getSalesInvoiceLines: vi.fn(),
  getSalesInvoiceShipment: vi.fn(),
  getCustomer: vi.fn(),
  getOpportunity: vi.fn(),
  getOpportunityDocuments: vi.fn(),
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
vi.mock("~/components/Layout", () => ({
  PanelProvider: () => null,
  ResizablePanels: () => null
}));
vi.mock("~/modules/accounting", () => ({
  getCurrencyByCode: mocks.getCurrencyByCode
}));
vi.mock("~/modules/invoicing", async () => {
  const utils = await import("~/modules/invoicing/invoicing.utils");
  return {
    ...utils,
    getCompanyHasOpenCredits: mocks.getCompanyHasOpenCredits,
    getSalesInvoice: mocks.getSalesInvoice,
    getSalesInvoiceLines: mocks.getSalesInvoiceLines,
    getSalesInvoiceShipment: mocks.getSalesInvoiceShipment
  };
});
vi.mock("~/modules/invoicing/ui/SalesInvoice/SalesInvoiceExplorer", () => ({
  default: () => null
}));
vi.mock("~/modules/invoicing/ui/SalesInvoice/SalesInvoiceHeader", () => ({
  default: () => null
}));
vi.mock("~/modules/invoicing/ui/SalesInvoice/SalesInvoiceProperties", () => ({
  default: () => null
}));
vi.mock("~/modules/sales/sales.service", () => ({
  getCustomer: mocks.getCustomer,
  getOpportunity: mocks.getOpportunity,
  getOpportunityDocuments: mocks.getOpportunityDocuments
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
      invoicingSales: "/x/sales-invoices",
      salesInvoice: (id: string) => `/x/sales-invoice/${id}`
    }
  }
}));

import { loader } from "./$invoiceId";

const client = { name: "client" };

const invoice = {
  id: "invoice-1",
  invoiceId: "SI-0001",
  totalAmount: 1000,
  balance: 750,
  currencyCode: "USD",
  exchangeRate: 0.9,
  customerId: null,
  opportunityId: null
};

beforeEach(() => {
  vi.resetAllMocks();

  mocks.requirePermissions.mockResolvedValue({
    client,
    companyId: "company-1",
    companyGroupId: "group-1"
  });
  mocks.getCarbonServiceRole.mockReturnValue({ name: "service-role" });
  mocks.flash.mockImplementation(async (_request, value) => value);
  mocks.error.mockImplementation((cause, message) => ({ cause, message }));
  mocks.getSalesInvoice.mockResolvedValue({ data: invoice, error: null });
  mocks.getSalesInvoiceLines.mockResolvedValue({ data: [], error: null });
  mocks.getSalesInvoiceShipment.mockResolvedValue({ data: null, error: null });
  mocks.getCompanyHasOpenCredits.mockResolvedValue(false);
  mocks.getCompanySettings.mockResolvedValue({
    data: { defaultCustomerCc: [] },
    error: null
  });
  mocks.getCurrencyByCode.mockResolvedValue({
    data: { decimalPlaces: 2 },
    error: null
  });
  mocks.getOpportunityDocuments.mockReturnValue([]);
});

function loadSalesInvoice() {
  return loader({
    request: new Request("http://localhost/x/sales-invoice/invoice-1"),
    params: { invoiceId: "invoice-1" }
  } as never);
}

describe("Sales Invoice settlement loader", () => {
  it("returns authoritative detail settlement values without aggregate FX filtering", async () => {
    mocks.getSalesInvoice.mockResolvedValue({
      data: {
        ...invoice,
        currencyCode: null,
        exchangeRate: null
      },
      error: null
    });

    const result = await loadSalesInvoice();

    expect(result.invoiceSettlement).toEqual({
      totalAmount: 1000,
      amountPaid: 250,
      balanceRemaining: 750
    });
  });

  it.each([
    ["null total", { totalAmount: null, balance: 750 }],
    ["null balance", { totalAmount: 1000, balance: null }],
    ["non-finite total", { totalAmount: Number.NaN, balance: 750 }]
  ])("redirects for malformed authoritative fields: %s", async (_label, values) => {
    mocks.getSalesInvoice.mockResolvedValue({
      data: { ...invoice, ...values },
      error: null
    });

    await expect(loadSalesInvoice()).rejects.toMatchObject({ status: 302 });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.any(Error),
      "Failed to load sales invoice"
    );
  });
});
