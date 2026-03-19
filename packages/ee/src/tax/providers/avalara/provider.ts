import { HTTPClient } from "../../../accounting/core/utils";
import { TaxProviderID } from "../../core/models";
import type {
  BaseTaxProvider,
  TaxCalculationRequest,
  TaxCalculationResult
} from "../../core/types";

interface AvalaraConfig {
  accountId: string;
  licenseKey: string;
  companyCode: string;
  environment: "sandbox" | "production";
}

interface AvalaraLine {
  number: string;
  amount: number;
  taxCode?: string;
  itemCode?: string;
  description?: string;
  quantity: number;
}

interface AvalaraTransactionRequest {
  type: "SalesOrder" | "SalesInvoice" | "PurchaseOrder" | "PurchaseInvoice";
  companyCode: string;
  date: string;
  customerCode?: string;
  currencyCode: string;
  commit: boolean;
  addresses: {
    shipFrom: {
      line1?: string;
      line2?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      country?: string;
    };
    shipTo: {
      line1?: string;
      line2?: string;
      city?: string;
      region?: string;
      postalCode?: string;
      country?: string;
    };
  };
  lines: AvalaraLine[];
  exemptionNo?: string;
}

interface AvalaraTransactionResponse {
  id: number;
  code: string;
  totalTax: number;
  lines: Array<{
    lineNumber: string;
    tax: number;
    taxableAmount: number;
    rate: number;
    details: Array<{
      jurisName: string;
      rate: number;
      tax: number;
    }>;
  }>;
}

const DOCUMENT_TYPE_MAP: Record<string, AvalaraTransactionRequest["type"]> = {
  salesOrder: "SalesOrder",
  salesInvoice: "SalesInvoice",
  purchaseOrder: "PurchaseOrder",
  purchaseInvoice: "PurchaseInvoice"
};

export class AvalaraProvider implements BaseTaxProvider {
  readonly id = TaxProviderID.AVALARA;
  private http: HTTPClient;
  private companyCode: string;
  private authHeader: string;

  constructor(config: AvalaraConfig) {
    const baseUrl =
      config.environment === "production"
        ? "https://rest.avatax.com/api/v2"
        : "https://sandbox-rest.avatax.com/api/v2";

    this.http = new HTTPClient(baseUrl);
    this.companyCode = config.companyCode;
    this.authHeader = `Basic ${btoa(`${config.accountId}:${config.licenseKey}`)}`;
  }

  async calculateTax(
    request: TaxCalculationRequest
  ): Promise<TaxCalculationResult> {
    const body: AvalaraTransactionRequest = {
      type: DOCUMENT_TYPE_MAP[request.documentType] ?? "SalesOrder",
      companyCode: this.companyCode,
      date: request.documentDate ?? new Date().toISOString().split("T")[0],
      customerCode: request.customerCode,
      currencyCode: request.currencyCode,
      commit: request.commit ?? false,
      addresses: {
        shipFrom: {
          line1: request.origin.line1,
          line2: request.origin.line2,
          city: request.origin.city,
          region: request.origin.region,
          postalCode: request.origin.postalCode,
          country: request.origin.country
        },
        shipTo: {
          line1: request.destination.line1,
          line2: request.destination.line2,
          city: request.destination.city,
          region: request.destination.region,
          postalCode: request.destination.postalCode,
          country: request.destination.country
        }
      },
      lines: request.lines.map((line) => ({
        number: line.id,
        amount: line.amount,
        taxCode: line.taxCode,
        itemCode: line.itemCode,
        description: line.description,
        quantity: line.quantity
      }))
    };

    if (request.exemption?.exempt && request.exemption.certificateNumber) {
      body.exemptionNo = request.exemption.certificateNumber;
    }

    const response = await this.http.request<AvalaraTransactionResponse>(
      "POST",
      "/transactions/create",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: this.authHeader
        },
        body: JSON.stringify(body)
      }
    );

    if (response.error || !response.data) {
      throw new Error(
        `Avalara tax calculation failed: ${response.message} ${
          typeof response.data === "object"
            ? JSON.stringify(response.data)
            : response.data
        }`
      );
    }

    const data = response.data;

    return {
      totalTax: data.totalTax,
      documentCode: data.code,
      lines: data.lines.map((line) => ({
        lineId: line.lineNumber,
        taxAmount: line.tax,
        taxRate:
          line.taxableAmount > 0 ? line.tax / line.taxableAmount : line.rate,
        details: line.details?.map((d) => ({
          jurisdiction: d.jurisName,
          rate: d.rate,
          amount: d.tax
        }))
      }))
    };
  }

  async validate(): Promise<boolean> {
    const response = await this.http.request<{ authenticated: boolean }>(
      "GET",
      "/utilities/ping",
      {
        headers: {
          Authorization: this.authHeader
        }
      }
    );

    if (response.error || !response.data) {
      return false;
    }

    return response.data.authenticated === true;
  }

  async voidTransaction(documentCode: string): Promise<void> {
    const response = await this.http.request(
      "POST",
      `/companies/${encodeURIComponent(this.companyCode)}/transactions/${encodeURIComponent(documentCode)}/void`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: this.authHeader
        },
        body: JSON.stringify({ code: "DocVoided" })
      }
    );

    if (response.error) {
      throw new Error(`Avalara void failed: ${response.message}`);
    }
  }
}
