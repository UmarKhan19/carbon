import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AvalaraProvider, TaxJarProvider } from "../providers";
import { TaxIntegrationMetadataSchema, TaxProviderID } from "./models";
import type {
  BaseTaxProvider,
  TaxAddress,
  TaxCalculationRequest,
  TaxCalculationResult,
  TaxDocumentType,
  TaxLineItem
} from "./types";

interface TaxProviderInfo {
  provider: BaseTaxProvider;
  metadata: { defaultTaxCode?: string; enableLogging: boolean };
}

export class TaxCalculationService {
  constructor(
    private client: SupabaseClient<Database>,
    private companyId: string
  ) {}

  async getActiveTaxProvider(): Promise<TaxProviderInfo | null> {
    const { data: integrations } = await this.client
      .from("companyIntegration")
      .select("integrationId, active, metadata")
      .eq("companyId", this.companyId)
      .in("integrationId", [TaxProviderID.AVALARA, TaxProviderID.TAXJAR])
      .eq("active", true)
      .limit(1);

    if (!integrations || integrations.length === 0) {
      return null;
    }

    const integration = integrations[0];
    const rawMetadata = integration.metadata as Record<string, unknown>;

    const settingsParse = TaxIntegrationMetadataSchema.safeParse(rawMetadata);
    const settings = settingsParse.success
      ? settingsParse.data
      : { defaultTaxCode: undefined, enableLogging: true };

    let provider: BaseTaxProvider;

    if (integration.integrationId === TaxProviderID.AVALARA) {
      provider = new AvalaraProvider({
        accountId: rawMetadata.accountId as string,
        licenseKey: rawMetadata.licenseKey as string,
        companyCode: rawMetadata.companyCode as string,
        environment:
          (rawMetadata.environment as "sandbox" | "production") ?? "sandbox"
      });
    } else {
      provider = new TaxJarProvider({
        apiKey: rawMetadata.apiKey as string,
        environment:
          (rawMetadata.environment as "sandbox" | "production") ?? "sandbox"
      });
    }

    return { provider, metadata: settings };
  }

  async resolveLineTaxCodes(
    lines: TaxLineItem[],
    integration: string,
    defaultTaxCode?: string
  ): Promise<TaxLineItem[]> {
    const postingGroupIds = [
      ...new Set(
        lines
          .map((l) => l.itemPostingGroupId)
          .filter((id): id is string => id != null)
      )
    ];

    if (postingGroupIds.length === 0) {
      return lines.map((line) => ({
        ...line,
        taxCode: line.taxCode ?? defaultTaxCode
      }));
    }

    const { data: mappings } = await this.client
      .from("taxCodeMapping")
      .select("itemPostingGroupId, taxCode")
      .eq("companyId", this.companyId)
      .eq("integration", integration)
      .in("itemPostingGroupId", postingGroupIds);

    const mappingMap = new Map(
      (mappings ?? []).map((m) => [m.itemPostingGroupId, m.taxCode])
    );

    return lines.map((line) => ({
      ...line,
      taxCode:
        line.taxCode ??
        (line.itemPostingGroupId
          ? mappingMap.get(line.itemPostingGroupId)
          : undefined) ??
        defaultTaxCode
    }));
  }

  async getCompanyAddress(): Promise<TaxAddress> {
    const { data: company } = await this.client
      .from("company")
      .select(
        "addressLine1, addressLine2, city, stateProvince, postalCode, countryCode"
      )
      .eq("id", this.companyId)
      .single();

    if (!company) {
      return {};
    }

    return {
      line1: company.addressLine1 ?? undefined,
      line2: company.addressLine2 ?? undefined,
      city: company.city ?? undefined,
      region: company.stateProvince ?? undefined,
      postalCode: company.postalCode ?? undefined,
      country: company.countryCode ?? undefined
    };
  }

  async calculateTax(request: {
    documentType: TaxDocumentType;
    documentId: string;
    documentDate?: string;
    currencyCode: string;
    customerCode?: string;
    destination: TaxAddress;
    lines: TaxLineItem[];
    exemption?: {
      exempt: boolean;
      reason?: string;
      certificateNumber?: string;
    };
    commit?: boolean;
  }): Promise<TaxCalculationResult | null> {
    const providerInfo = await this.getActiveTaxProvider();
    if (!providerInfo) {
      return null;
    }

    const { provider, metadata } = providerInfo;
    const origin = await this.getCompanyAddress();
    const resolvedLines = await this.resolveLineTaxCodes(
      request.lines,
      provider.id,
      metadata.defaultTaxCode
    );

    const fullRequest: TaxCalculationRequest = {
      companyId: this.companyId,
      ...request,
      origin,
      lines: resolvedLines
    };

    const startTime = Date.now();
    let result: TaxCalculationResult;
    let error: string | undefined;

    try {
      result = await provider.calculateTax(fullRequest);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);

      if (metadata.enableLogging) {
        await this.logCalculation({
          integration: provider.id,
          documentType: request.documentType,
          documentId: request.documentId,
          status: "error",
          errorMessage: error,
          durationMs: Date.now() - startTime
        });
      }

      throw err;
    }

    if (metadata.enableLogging) {
      await this.logCalculation({
        integration: provider.id,
        documentType: request.documentType,
        documentId: request.documentId,
        status: "success",
        totalTax: result.totalTax,
        requestSummary: {
          lineCount: request.lines.length,
          destination: request.destination
        },
        responseSummary: {
          lines: result.lines.map((l) => ({
            lineId: l.lineId,
            taxAmount: l.taxAmount,
            taxRate: l.taxRate
          }))
        },
        durationMs: Date.now() - startTime
      });
    }

    return result;
  }

  private async logCalculation(entry: {
    integration: string;
    documentType: string;
    documentId: string;
    status: string;
    totalTax?: number;
    requestSummary?: Record<string, unknown>;
    responseSummary?: Record<string, unknown>;
    errorMessage?: string;
    durationMs: number;
  }): Promise<void> {
    try {
      await this.client.from("taxCalculationLog").insert({
        ...entry,
        companyId: this.companyId
      });
    } catch {
      // Logging should never prevent tax calculation from returning
      console.error("[TaxCalculationService] Failed to write log entry");
    }
  }
}
