import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

const BASE_URLS = {
  sandbox: "https://demo.docusign.net/restapi",
  production: "https://na1.docusign.net/restapi"
} as const;

export const DocuSign = defineIntegration({
  name: "DocuSign",
  id: "docusign",
  active: true,
  category: "Document Signing",
  logo: Logo,
  description:
    "DocuSign is the world's leading electronic signature platform. With this integration, you can send purchase orders for electronic signature directly from Carbon.",
  shortDescription: "Send purchase orders for e-signature via DocuSign.",
  setupInstructions: SetupInstructions,
  images: [],
  settings: [
    {
      name: "integrationKey",
      label: "Integration Key",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "secretKey",
      label: "Secret Key",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "accountId",
      label: "Account ID",
      type: "text",
      required: true,
      value: ""
    },
    {
      name: "webhookSecret",
      label: "Webhook Secret (HMAC)",
      type: "text",
      required: false,
      value: ""
    },
    {
      name: "environment",
      label: "Environment",
      type: "options",
      listOptions: [
        {
          value: "sandbox",
          label: "Sandbox",
          description: "For development and testing"
        },
        {
          value: "production",
          label: "Production",
          description: "For live use"
        }
      ],
      required: true,
      value: "sandbox"
    }
  ],
  schema: z.object({
    integrationKey: z
      .string()
      .min(1, { message: "Integration Key is required" }),
    secretKey: z.string().min(1, { message: "Secret Key is required" }),
    accountId: z.string().min(1, { message: "Account ID is required" }),
    webhookSecret: z.string().optional(),
    environment: z.enum(["sandbox", "production"])
  }),
  onHealthcheck: healthcheck
});

async function healthcheck(
  _companyId: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  const integrationKey = metadata.integrationKey as string | undefined;
  const secretKey = metadata.secretKey as string | undefined;
  const accountId = metadata.accountId as string | undefined;
  const environment =
    (metadata.environment as "sandbox" | "production") ?? "sandbox";

  if (!integrationKey || !secretKey || !accountId) {
    return false;
  }

  try {
    const baseUrl = BASE_URLS[environment];
    const credentials = btoa(`${integrationKey}:${secretKey}`);

    const response = await fetch(`${baseUrl}/v2.1/accounts/${accountId}`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json"
      }
    });

    return response.ok;
  } catch {
    return false;
  }
}

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/${DocuSign.id}/${companyId}`
    : "";

  return (
    <>
      <p className="text-sm text-muted-foreground">
        To integrate DocuSign with Carbon, log into your DocuSign developer
        account and navigate to the "Apps and Keys" page.
      </p>
      <p className="text-sm text-muted-foreground">
        Create a new app or use an existing one. Copy the "Integration Key" and
        "Secret Key" from the app settings, and the "API Account ID" from the
        top of the page.
      </p>
      <p className="text-sm text-muted-foreground">
        To receive real-time status updates, set up a DocuSign Connect webhook
        using the URL below. Enable HMAC verification and paste the HMAC key
        into the "Webhook Secret" field.
      </p>
      <InputGroup className="mb-8">
        <Input value={webhookUrl} readOnly />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>
      <p className="text-sm text-muted-foreground">
        Paste your Integration Key, Secret Key, and Account ID into the fields
        below. Select the environment that matches your DocuSign account
        (Sandbox for testing, Production for live use).
      </p>
    </>
  );
}

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={200}
      height={200}
      viewBox="0 0 24 24"
      fill="none"
      {...props}
    >
      <title>DocuSign</title>
      <path
        fill="currentColor"
        d="M22 2H7a2 2 0 0 0-2 2v1H3a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-1h2a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM3 20V7h12v13H3Zm19-3h-2V7a2 2 0 0 0-2-2H7V4h15v13Z"
      />
      <path
        fill="currentColor"
        d="m7.3 16.2 1.4 1.1 5.3-6.7-1.4-1.1-5.3 6.7Zm-1.6-2.5 1.4 1.1 2.4-3-1.4-1.1-2.4 3Z"
      />
    </svg>
  );
}
