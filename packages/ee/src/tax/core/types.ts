import type { TaxProviderID } from "./models";

export interface TaxAddress {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface TaxLineItem {
  id: string;
  itemCode?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxCode?: string;
  itemPostingGroupId?: string;
}

export interface TaxExemption {
  exempt: boolean;
  reason?: string;
  certificateNumber?: string;
}

export type TaxDocumentType =
  | "salesOrder"
  | "purchaseOrder"
  | "salesInvoice"
  | "purchaseInvoice";

export interface TaxCalculationRequest {
  companyId: string;
  documentType: TaxDocumentType;
  documentId: string;
  documentDate?: string;
  currencyCode: string;
  customerCode?: string;
  origin: TaxAddress;
  destination: TaxAddress;
  lines: TaxLineItem[];
  exemption?: TaxExemption;
  commit?: boolean;
}

export interface TaxLineResult {
  lineId: string;
  taxAmount: number;
  taxRate: number;
  details?: Array<{
    jurisdiction: string;
    rate: number;
    amount: number;
  }>;
}

export interface TaxCalculationResult {
  totalTax: number;
  lines: TaxLineResult[];
  documentCode?: string;
}

export interface BaseTaxProvider {
  readonly id: TaxProviderID;

  calculateTax(request: TaxCalculationRequest): Promise<TaxCalculationResult>;

  validate(): Promise<boolean>;

  voidTransaction?(documentId: string): Promise<void>;
}
