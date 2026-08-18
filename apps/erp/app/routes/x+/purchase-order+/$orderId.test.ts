import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./$orderId";

const mocks = vi.hoisted(() => ({
  requirePermissions: vi.fn(),
  getCarbonServiceRole: vi.fn(),
  flash: vi.fn(),
  error: vi.fn(),
  getCurrencyByCode: vi.fn(),
  getPaymentTermsList: vi.fn(),
  upsertDocument: vi.fn(),
  getDefaultAttachmentsForPO: vi.fn(),
  getPurchaseOrder: vi.fn(),
  getPurchaseOrderDelivery: vi.fn(),
  getPurchaseOrderLines: vi.fn(),
  getPurchaseOrderLocations: vi.fn(),
  getSupplier: vi.fn(),
  getSupplierContact: vi.fn(),
  getSupplierInteraction: vi.fn(),
  getSupplierInteractionDocuments: vi.fn(),
  getPurchaseOrderInvoiceLines: vi.fn(),
  getPurchaseOrderInvoicesByIds: vi.fn(),
  getCompany: vi.fn(),
  getCompanySettings: vi.fn(),
  getLatestApprovalRequestForDocument: vi.fn(),
  getLowerTierApproverUserIds: vi.fn(),
  canApproveRequest: vi.fn(),
  canCancelRequest: vi.fn(),
  approveRequest: vi.fn(),
  rejectRequest: vi.fn(),
  getUser: vi.fn(),
  getDatabaseClient: vi.fn(),
  pdfLoader: vi.fn(),
  stripSpecialCharacters: vi.fn()
}));

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  error: mocks.error,
  success: vi.fn()
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
vi.mock("@carbon/documents/email", () => ({
  PurchaseOrderEmail: vi.fn()
}));
vi.mock("@carbon/form", () => ({
  validationError: vi.fn(),
  validator: vi.fn()
}));
vi.mock("@carbon/jobs", () => ({
  trigger: vi.fn()
}));
vi.mock("@carbon/logger", () => ({
  getLogger: vi.fn(() => ({ error: vi.fn() }))
}));
vi.mock("@carbon/notifications", () => ({
  NotificationEvent: {
    ApprovalApproved: "ApprovalApproved",
    ApprovalRejected: "ApprovalRejected"
  }
}));
vi.mock("@carbon/react", () => ({
  VStack: () => null
}));
vi.mock("@lingui/core/macro", () => ({
  msg: (value: unknown) => value
}));
vi.mock("@react-email/components", () => ({
  renderAsync: vi.fn()
}));
vi.mock("~/components/Layout/Panels", () => ({
  PanelProvider: () => null,
  ResizablePanels: () => null
}));
vi.mock("~/modules/accounting", () => ({
  getCurrencyByCode: mocks.getCurrencyByCode,
  getPaymentTermsList: mocks.getPaymentTermsList
}));
vi.mock("~/modules/documents", () => ({
  upsertDocument: mocks.upsertDocument
}));
vi.mock("~/modules/invoicing", async () => {
  const utils = await import("~/modules/invoicing/invoicing.utils");
  return {
    ...utils,
    getPurchaseOrderInvoiceLines: mocks.getPurchaseOrderInvoiceLines,
    getPurchaseOrderInvoicesByIds: mocks.getPurchaseOrderInvoicesByIds
  };
});
vi.mock("~/modules/purchasing", () => ({
  getDefaultAttachmentsForPO: mocks.getDefaultAttachmentsForPO,
  getPurchaseOrder: mocks.getPurchaseOrder,
  getPurchaseOrderDelivery: mocks.getPurchaseOrderDelivery,
  getPurchaseOrderLines: mocks.getPurchaseOrderLines,
  getPurchaseOrderLocations: mocks.getPurchaseOrderLocations,
  getSupplier: mocks.getSupplier,
  getSupplierContact: mocks.getSupplierContact,
  getSupplierInteraction: mocks.getSupplierInteraction,
  getSupplierInteractionDocuments: mocks.getSupplierInteractionDocuments,
  purchaseOrderApprovalValidator: {}
}));
vi.mock("~/modules/purchasing/ui/PurchaseOrder", () => ({
  PurchaseOrderExplorer: () => null,
  PurchaseOrderHeader: () => null,
  PurchaseOrderProperties: () => null
}));
vi.mock("~/modules/settings", () => ({
  getCompany: mocks.getCompany,
  getCompanySettings: mocks.getCompanySettings
}));
vi.mock("~/modules/shared", () => ({
  approveRequest: mocks.approveRequest,
  canApproveRequest: mocks.canApproveRequest,
  canCancelRequest: mocks.canCancelRequest,
  getLatestApprovalRequestForDocument:
    mocks.getLatestApprovalRequestForDocument,
  getLowerTierApproverUserIds: mocks.getLowerTierApproverUserIds,
  rejectRequest: mocks.rejectRequest
}));
vi.mock("~/modules/users/users.server", () => ({
  getUser: mocks.getUser
}));
vi.mock("~/routes/file+/purchase-order+/$orderId[.]pdf", () => ({
  loader: mocks.pdfLoader
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: mocks.getDatabaseClient
}));
vi.mock("~/utils/handle", () => ({
  detailBreadcrumb: vi.fn(() => ({}))
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      items: "/x/items",
      purchaseOrder: (id: string) => `/x/purchase-order/${id}`,
      purchaseOrders: "/x/purchase-orders"
    }
  }
}));
vi.mock("~/utils/string", () => ({
  stripSpecialCharacters: mocks.stripSpecialCharacters
}));

type InvoiceRow = {
  id: string | null;
  totalAmount: number | null;
  balance: number | null;
  currencyCode: string | null;
  exchangeRate: number | null;
};

const client = { name: "client" };
const purchaseOrder = {
  id: "order-1",
  purchaseOrderId: "PO-0001",
  companyId: "company-1",
  supplierId: "supplier-1",
  supplierInteractionId: "interaction-1",
  currencyCode: "USD",
  status: "Draft",
  exchangeRate: 0.8
};

beforeEach(() => {
  vi.resetAllMocks();

  mocks.requirePermissions.mockResolvedValue({
    client,
    companyId: "company-1",
    companyGroupId: "group-1",
    userId: "user-1"
  });
  mocks.getCarbonServiceRole.mockReturnValue({ name: "service-role" });
  mocks.flash.mockImplementation(async (_request, value) => value);
  mocks.error.mockImplementation((cause, message) => ({ cause, message }));
  mocks.getPurchaseOrder.mockResolvedValue({
    data: purchaseOrder,
    error: null
  });
  mocks.getPurchaseOrderLines.mockResolvedValue({ data: [], error: null });
  mocks.getPurchaseOrderDelivery.mockResolvedValue({ data: null, error: null });
  mocks.getPurchaseOrderInvoiceLines.mockResolvedValue({
    data: [{ invoiceId: "invoice-1" }, { invoiceId: "invoice-1" }],
    error: null
  });
  mocks.getPurchaseOrderInvoicesByIds.mockResolvedValue({
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
  mocks.getSupplier.mockResolvedValue({
    data: { defaultCc: [] },
    error: null
  });
  mocks.getSupplierInteraction.mockResolvedValue({ data: {}, error: null });
  mocks.getCompanySettings.mockResolvedValue({
    data: { defaultSupplierCc: [] },
    error: null
  });
  mocks.getDefaultAttachmentsForPO.mockResolvedValue([]);
  mocks.getSupplierInteractionDocuments.mockResolvedValue([]);
  mocks.getCurrencyByCode.mockResolvedValue({
    data: { decimalPlaces: 2 },
    error: null
  });
});

function loadPurchaseOrder() {
  return loader({
    request: new Request("http://localhost/x/purchase-order/order-1"),
    params: { orderId: "order-1" }
  } as never);
}

describe("Purchase Order settlement loader", () => {
  it("uses the linked invoice rate for base and presentation settlement summaries", async () => {
    const result = await loadPurchaseOrder();

    expect(mocks.getPurchaseOrderInvoiceLines).toHaveBeenCalledWith(
      client,
      "company-1",
      "order-1"
    );
    expect(mocks.getPurchaseOrderInvoicesByIds).toHaveBeenCalledWith(
      client,
      "company-1",
      ["invoice-1"]
    );
    expect(result.invoiceSummary).toMatchObject({
      invoicedAmount: 1000,
      paidAmount: 250,
      balanceRemaining: 750,
      presentationInvoicedAmount: 900,
      presentationPaidAmount: 225,
      presentationBalanceRemaining: 675,
      includedInvoiceCount: 1,
      currencyMismatchCount: 0,
      invalidExchangeRateCount: 0
    });
  });

  it("does not query or mark Paid when there are no linked invoices", async () => {
    mocks.getPurchaseOrderInvoiceLines.mockResolvedValue({
      data: [],
      error: null
    });

    const result = await loadPurchaseOrder();

    expect(mocks.getPurchaseOrderInvoicesByIds).not.toHaveBeenCalled();
    expect(result.invoiceSummary).toMatchObject({
      invoicedAmount: 0,
      paidAmount: 0,
      balanceRemaining: 0,
      presentationInvoicedAmount: 0,
      presentationPaidAmount: 0,
      presentationBalanceRemaining: 0,
      includedInvoiceCount: 0
    });
  });

  it("reports unresolved currency and invalid exchange-rate rows instead of including them", async () => {
    mocks.getPurchaseOrderInvoicesByIds.mockResolvedValue({
      data: [
        {
          id: "invoice-1",
          totalAmount: 400,
          balance: 0,
          currencyCode: null,
          exchangeRate: null
        },
        {
          id: "invoice-2",
          totalAmount: 100,
          balance: 0,
          currencyCode: "USD",
          exchangeRate: -1
        }
      ],
      error: null
    });
    mocks.getPurchaseOrderInvoiceLines.mockResolvedValue({
      data: [{ invoiceId: "invoice-1" }, { invoiceId: "invoice-2" }],
      error: null
    });

    const result = await loadPurchaseOrder();

    expect(result.invoiceSummary).toMatchObject({
      invoicedAmount: 0,
      paidAmount: 0,
      balanceRemaining: 0,
      presentationInvoicedAmount: 0,
      presentationPaidAmount: 0,
      presentationBalanceRemaining: 0,
      includedInvoiceCount: 0,
      currencyMismatchCount: 1,
      invalidExchangeRateCount: 1
    });
  });

  it("redirects instead of understating totals when a linked batch row is missing", async () => {
    mocks.getPurchaseOrderInvoicesByIds.mockResolvedValue({
      data: [],
      error: null
    });

    await expect(loadPurchaseOrder()).rejects.toMatchObject({ status: 302 });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.any(Error),
      "Failed to load purchase invoice totals"
    );
  });

  it("redirects instead of coercing a null authoritative total to zero", async () => {
    mocks.getPurchaseOrderInvoicesByIds.mockResolvedValue({
      data: [
        {
          id: "invoice-1",
          totalAmount: null,
          balance: 100,
          currencyCode: "USD",
          exchangeRate: 1
        }
      ],
      error: null
    });

    await expect(loadPurchaseOrder()).rejects.toMatchObject({ status: 302 });
    expect(mocks.error).toHaveBeenCalledWith(
      expect.any(Error),
      "Failed to load purchase invoice totals"
    );
  });
});
