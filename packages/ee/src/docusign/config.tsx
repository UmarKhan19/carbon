import { DOCUSIGN_CLIENT_ID } from "@carbon/auth";
import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { getDocuSignClient } from "./lib";

console.log(DOCUSIGN_CLIENT_ID);
export const DocuSign = defineIntegration({
  name: "DocuSign",
  id: "docusign",
  active: !!DOCUSIGN_CLIENT_ID,
  category: "Document Signing",
  logo: Logo,
  description:
    "DocuSign is the world's leading electronic signature platform. With this integration, you can send purchase orders for electronic signature directly from Carbon.",
  shortDescription: "Send purchase orders for e-signature via DocuSign.",
  setupInstructions: SetupInstructions,
  images: [],
  oauth: {
    authUrl: "https://account-d.docusign.com/oauth/auth",
    clientId: DOCUSIGN_CLIENT_ID!,
    redirectUri: "/api/integrations/docusign/oauth",
    scopes: ["signature", "extended"],
    tokenUrl: "https://account-d.docusign.com/oauth/token"
  },
  settings: [
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
    webhookSecret: z.string().optional(),
    environment: z.enum(["sandbox", "production"])
  }),
  onHealthcheck: healthcheck
});

async function healthcheck(
  companyId: string,
  _metadata: Record<string, unknown>
): Promise<boolean> {
  const client = getDocuSignClient();
  return await client.healthcheck(companyId);
}

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/${DocuSign.id}/${companyId}`
    : "";

  return (
    <>
      <p className="text-sm text-muted-foreground">
        To integrate DocuSign with Carbon, click the "Connect" button above to
        authorize Carbon with your DocuSign account.
      </p>
      <p className="text-sm text-muted-foreground">
        To receive real-time status updates, set up a DocuSign Connect webhook
        in your DocuSign admin portal using the URL below. Enable HMAC
        verification and paste the HMAC key into the "Webhook Secret" field.
      </p>
      <InputGroup className="mb-8">
        <Input value={webhookUrl} readOnly />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>
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
