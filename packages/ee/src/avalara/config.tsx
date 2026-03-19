import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { AvalaraProvider } from "../tax/providers/avalara/provider";

const AvalaraSettingsSchema = z.object({
  accountId: z.string().min(1),
  licenseKey: z.string().min(1),
  companyCode: z.string().min(1),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
  defaultTaxCode: z.string().optional(),
  enableLogging: z.preprocess(
    (v) =>
      v === "true" || v === "on" ? true : v === "false" || v === "" ? false : v,
    z.boolean().default(true)
  )
});

export const Avalara = defineIntegration({
  name: "Avalara AvaTax",
  id: "avalara",
  active: true,
  category: "Tax",
  logo: Logo,
  description:
    "Integrate with Avalara AvaTax to automatically calculate sales and use tax for your sales and purchasing documents. Supports tax exemption certificates, product tax codes via item posting groups, and real-time tax calculation.",
  shortDescription:
    "Automated sales tax calculation for sales and purchase orders.",
  images: [],
  settings: [
    {
      name: "accountId",
      label: "Account ID",
      description: "Your Avalara account ID",
      type: "text" as const,
      required: true,
      value: ""
    },
    {
      name: "licenseKey",
      label: "License Key",
      description: "Your Avalara license key",
      type: "text" as const,
      required: true,
      value: ""
    },
    {
      name: "companyCode",
      label: "Company Code",
      description: "The company code configured in your Avalara account",
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
        "Fallback Avalara tax code when no item posting group mapping exists (e.g. P0000000)",
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
  schema: AvalaraSettingsSchema,
  async onHealthcheck(_companyId, metadata) {
    const m = metadata as Record<string, unknown>;
    const provider = new AvalaraProvider({
      accountId: m.accountId as string,
      licenseKey: m.licenseKey as string,
      companyCode: m.companyCode as string,
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
      <rect width="40" height="40" rx="8" fill="#F26622" />
      <path d="M20 8L10 32H15L20 20L25 32H30L20 8Z" fill="white" />
    </svg>
  );
}
