import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermissions: vi.fn(),
  flash: vi.fn(),
  error: vi.fn(),
  getCurrencyByCode: vi.fn(),
  getCompanyHasOpenCredits: vi.fn(),
  getPurchaseInvoice: vi.fn(),
  getPurchaseInvoiceDelivery: vi.fn(),
  getPurchaseInvoiceLines: vi.fn(),
  getSupplier: vi.fn(),
  getSupplierInteraction: vi.fn(),
  getSupplierInteractionDocuments: vi.fn()
}));

vi.mock("@carbon/auth", () => ({
  error: mocks.error
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: mocks.requirePermissions
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
    getPurchaseInvoice: mocks.getPurchaseInvoice,
    getPurchaseInvoiceDelivery: mocks.getPurchaseInvoiceDelivery,
    getPurchaseInvoiceLines: mocks.getPurchaseInvoiceLines
  };
});
vi.mock("~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader", () => ({
  default: () => null
}));
vi.mock(
  "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceExplorer",
  () => ({ default: () => null })
);
vi.mock(
  "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceProperties",
  () => ({ default: () => null })
);
vi.mock("~/modules/purchasing/purchasing.service", () => ({
  getSupplier: mocks.getSupplier,
  getSupplierInteraction: mocks.getSupplierInteraction,
  getSupplierInteractionDocuments: mocks.getSupplierInteractionDocuments
}));
vi.mock("~/utils/handle", () => ({
  detailBreadcrumb: vi.fn(() => ({}))
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      invoicingPurchasing: "/x/purchase-invoices",
      purchaseInvoice: (id: string) => `/x/purchase-invoice/${id}`,
      purchaseInvoiceDetails: (id: string) => `/x/purchase-invoice/${id}`
    }
  }
}));

import { loader } from "./$invoiceId";

const client = { name: "client" };

const invoice = {
  id: "invoice-1",
  invoiceId: "PI-0001",
  totalAmount: 1000,
  balance: 750,
  currencyCode: "USD",
  exchangeRate: 0.9,
  supplierId: null,
  supplierInteractionId: "interaction-1"
};

beforeEach(() => {
  vi.resetAllMocks();

  mocks.requirePermissions.mockResolvedValue({
    client,
    companyId: "company-1",
    companyGroupId: "group-1"
  });
  mocks.flash.mockImplementation(async (_request, value) => value);
  mocks.error.mockImplementation((cause, message) => ({ cause, message }));
  mocks.getPurchaseInvoice.mockResolvedValue({ data: invoice, error: null });
  mocks.getPurchaseInvoiceLines.mockResolvedValue({ data: [], error: null });
  mocks.getPurchaseInvoiceDelivery.mockResolvedValue({
    data: null,
    error: null
  });
  mocks.getCompanyHasOpenCredits.mockResolvedValue(false);
  mocks.getSupplierInteraction.mockResolvedValue({ data: {}, error: null });
  mocks.getSupplierInteractionDocuments.mockResolvedValue([]);
  mocks.getCurrencyByCode.mockResolvedValue({
    data: { decimalPlaces: 2 },
    error: null
  });
});

function loadPurchaseInvoice() {
  return loader({
    request: new Request("http://localhost/x/purchase-invoice/invoice-1"),
    params: { invoiceId: "invoice-1" }
  } as never);
}

describe("Purchase Invoice settlement loader", () => {
  it("returns authoritative detail settlement values without aggregate FX filtering", async () => {
    mocks.getPurchaseInvoice.mockResolvedValue({
      data: {
        ...invoice,
        currencyCode: null,
        exchangeRate: null
      },
      error: null
    });

    const result = await loadPurchaseInvoice();

    expect(result.invoiceSettlement).toEqual({
      totalAmount: 1000,
      amountPaid: 250,
      balanceRemaining: 750
    });
  });

  it.each([
    ["null total", { totalAmount: null, balance: 750 }],
    ["null balance", { totalAmount: 1000, balance: null }],
    [
      "non-finite balance",
      { totalAmount: 1000, balance: Number.POSITIVE_INFINITY }
    ]
  ])("redirects for malformed authoritative fields: %s", async (_label, values) => {
    mocks.getPurchaseInvoice.mockResolvedValue({
      data: { ...invoice, ...values },
      error: null
    });

    await expect(loadPurchaseInvoice()).rejects.toMatchObject({ status: 302 });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.any(Error),
      "Failed to load purchase invoice"
    );
  });
});
