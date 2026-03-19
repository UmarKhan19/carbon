import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { TaxJarProvider } from "../tax/providers/taxjar/provider";

const TaxJarSettingsSchema = z.object({
  apiKey: z.string().min(1),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
  defaultTaxCode: z.string().optional(),
  enableLogging: z.preprocess(
    (v) =>
      v === "true" || v === "on" ? true : v === "false" || v === "" ? false : v,
    z.boolean().default(true)
  )
});

export const TaxJar = defineIntegration({
  name: "TaxJar",
  id: "taxjar",
  active: true,
  category: "Tax",
  logo: Logo,
  description:
    "Integrate with TaxJar to automatically calculate sales tax for your sales and purchasing documents. Supports tax exemptions, product tax codes via item posting groups, and real-time tax calculation.",
  shortDescription: "Automated sales tax calculation powered by TaxJar.",
  images: [],
  settings: [
    {
      name: "apiKey",
      label: "API Key",
      description: "Your TaxJar API token",
      type: "text" as const,
      required: true,
      value: ""
    },
    {
      name: "environment",
      label: "Environment",
      description:
        "Use sandbox for testing, production for live tax calculation",
      type: "options" as const,
      listOptions: [
        {
          value: "sandbox",
          label: "Sandbox",
          description: "Test environment with no real tax filings"
        },
        {
          value: "production",
          label: "Production",
          description: "Live tax calculation and reporting"
        }
      ],
      required: true,
      value: "sandbox"
    },
    {
      name: "defaultTaxCode",
      label: "Default Tax Code",
      description:
        "Fallback TaxJar product tax code when no item posting group mapping exists (e.g. 31000)",
      type: "text" as const,
      required: false,
      value: ""
    },
    {
      name: "enableLogging",
      label: "Enable Logging",
      description: "Log tax calculation requests for audit and debugging",
      type: "switch" as const,
      required: false,
      value: true
    }
  ],
  schema: TaxJarSettingsSchema,
  async onHealthcheck(_companyId, metadata) {
    const m = metadata as Record<string, unknown>;
    const provider = new TaxJarProvider({
      apiKey: m.apiKey as string,
      environment: (m.environment as "sandbox" | "production") ?? "sandbox"
    });

    return await provider.validate();
  }
});

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="8" fill="#2FAC66" />
      <path d="M12 14H28V18H22V32H18V18H12V14Z" fill="white" />
    </svg>
  );
}
