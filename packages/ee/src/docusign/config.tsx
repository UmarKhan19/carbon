import { DOCUSIGN_CLIENT_ID } from "@carbon/auth";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { getDocuSignClient } from "./lib";

export const DocuSign = defineIntegration({
  name: "DocuSign",
  id: "docusign",
  active: !!DOCUSIGN_CLIENT_ID,
  category: "Documents",
  logo: Logo,
  description:
    "DocuSign is the world's leading electronic signature platform. With this integration, you can send purchase orders for electronic signature directly from Carbon.",
  shortDescription: "Send purchase orders for e-signature via DocuSign.",
  images: [],
  settings: [],
  oauth: {
    authUrl: "https://account-d.docusign.com/oauth/auth",
    clientId: DOCUSIGN_CLIENT_ID!,
    redirectUri: "/api/integrations/docusign/oauth",
    scopes: ["signature", "impersonation"],
    tokenUrl: "https://account-d.docusign.com/oauth/token"
  },
  onHealthcheck: healthcheck,
  schema: z.object({})
});

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      {...props}
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <title>DocuSign</title>
      <path d="M2.4 18h19.2v2.4H2.4V18zm0-4.8h19.2v2.4H2.4v-2.4zm3.6-4.8h12v2.4H6v-2.4zm3.6-4.8h4.8v2.4h-4.8V3.6z" />
    </svg>
  );
}

async function healthcheck(companyId: string, _: Record<string, unknown>) {
  const docusign = getDocuSignClient();
  return await docusign.healthcheck(companyId);
}
