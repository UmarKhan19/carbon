import { HTTPClient } from "../../../accounting/core/utils";
import { TaxProviderID } from "../../core/models";
import type {
  BaseTaxProvider,
  TaxCalculationRequest,
  TaxCalculationResult
} from "../../core/types";

interface TaxJarConfig {
  apiKey: string;
  environment: "sandbox" | "production";
}

interface TaxJarTaxRequest {
  from_country?: string;
  from_zip?: string;
  from_state?: string;
  from_city?: string;
  from_street?: string;
  to_country?: string;
  to_zip?: string;
  to_state?: string;
  to_city?: string;
  to_street?: string;
  shipping: number;
  line_items: Array<{
    id: string;
    quantity: number;
    unit_price: number;
    product_tax_code?: string;
    description?: string;
  }>;
  exemption_type?: string;
}

interface TaxJarTaxResponse {
  tax: {
    order_total_amount: number;
    amount_to_collect: number;
    rate: number;
    has_nexus: boolean;
    freight_taxable: boolean;
    breakdown?: {
      line_items: Array<{
        id: string;
        tax_collectable: number;
        combined_tax_rate: number;
        state_amount?: number;
        county_amount?: number;
        city_amount?: number;
        special_district_amount?: number;
      }>;
    };
  };
}

const EXEMPTION_REASON_MAP: Record<string, string> = {
  Resale: "wholesale",
  Government: "government",
  Nonprofit: "non_exempt",
  Other: "other"
};

export class TaxJarProvider implements BaseTaxProvider {
  readonly id = TaxProviderID.TAXJAR;
  private http: HTTPClient;
  private authHeader: string;

  constructor(config: TaxJarConfig) {
    const baseUrl =
      config.environment === "production"
        ? "https://api.taxjar.com"
        : "https://api.sandbox.taxjar.com";

    this.http = new HTTPClient(baseUrl);
    this.authHeader = `Bearer ${config.apiKey}`;
  }

  async calculateTax(
    request: TaxCalculationRequest
  ): Promise<TaxCalculationResult> {
    const body: TaxJarTaxRequest = {
      from_country: request.origin.country,
      from_zip: request.origin.postalCode,
      from_state: request.origin.region,
      from_city: request.origin.city,
      from_street: request.origin.line1,
      to_country: request.destination.country,
      to_zip: request.destination.postalCode,
      to_state: request.destination.region,
      to_city: request.destination.city,
      to_street: request.destination.line1,
      shipping: 0,
      line_items: request.lines.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        product_tax_code: line.taxCode,
        description: line.description
      }))
    };

    if (request.exemption?.exempt && request.exemption.reason) {
      body.exemption_type =
        EXEMPTION_REASON_MAP[request.exemption.reason] ?? "other";
    }

    const response = await this.http.request<TaxJarTaxResponse>(
      "POST",
      "/v2/taxes",
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
        `TaxJar tax calculation failed: ${response.message} ${
          typeof response.data === "object"
            ? JSON.stringify(response.data)
            : response.data
        }`
      );
    }

    const { tax } = response.data;
    const lineBreakdowns = tax.breakdown?.line_items ?? [];

    return {
      totalTax: tax.amount_to_collect,
      lines: request.lines.map((line) => {
        const breakdown = lineBreakdowns.find((b) => b.id === line.id);
        if (breakdown) {
          return {
            lineId: line.id,
            taxAmount: breakdown.tax_collectable,
            taxRate: breakdown.combined_tax_rate,
            details: [
              breakdown.state_amount != null && {
                jurisdiction: "State",
                rate: breakdown.combined_tax_rate,
                amount: breakdown.state_amount
              },
              breakdown.county_amount != null && {
                jurisdiction: "County",
                rate: 0,
                amount: breakdown.county_amount
              },
              breakdown.city_amount != null && {
                jurisdiction: "City",
                rate: 0,
                amount: breakdown.city_amount
              },
              breakdown.special_district_amount != null && {
                jurisdiction: "Special District",
                rate: 0,
                amount: breakdown.special_district_amount
              }
            ].filter(
              (
                d
              ): d is { jurisdiction: string; rate: number; amount: number } =>
                d !== false
            )
          };
        }

        return {
          lineId: line.id,
          taxAmount: 0,
          taxRate: tax.rate
        };
      })
    };
  }

  async validate(): Promise<boolean> {
    const response = await this.http.request<{ categories: unknown[] }>(
      "GET",
      "/v2/categories",
      {
        headers: {
          Authorization: this.authHeader
        }
      }
    );

    return !response.error;
  }
}
