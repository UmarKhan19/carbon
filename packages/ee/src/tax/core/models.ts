import z from "zod";

export enum TaxProviderID {
  AVALARA = "avalara",
  TAXJAR = "taxjar"
}

export const TaxProviderCredentialsSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal(TaxProviderID.AVALARA),
    accountId: z.string().min(1),
    licenseKey: z.string().min(1),
    companyCode: z.string().min(1),
    environment: z.enum(["sandbox", "production"]).default("sandbox")
  }),
  z.object({
    provider: z.literal(TaxProviderID.TAXJAR),
    apiKey: z.string().min(1),
    environment: z.enum(["sandbox", "production"]).default("sandbox")
  })
]);

export type TaxProviderCredentials = z.infer<
  typeof TaxProviderCredentialsSchema
>;

export const TaxIntegrationMetadataSchema = z.object({
  defaultTaxCode: z.string().optional(),
  enableLogging: z.boolean().default(true)
});

export type TaxIntegrationMetadata = z.infer<
  typeof TaxIntegrationMetadataSchema
>;
