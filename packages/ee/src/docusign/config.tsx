import {
  DOCUSIGN_INTEGRATION_KEY,
  DOCUSIGN_OAUTH_REDIRECT_URL
} from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";

export const DocuSign = defineIntegration({
  name: "DocuSign",
  id: "docusign",
  category: "Documents",
  active: !!DOCUSIGN_INTEGRATION_KEY,
  logo: Logo,
  shortDescription: "Request e-signatures on purchase orders.",
  description:
    "Integrating Carbon with DocuSign allows you to send purchase order PDFs for signature and track signature status.",
  images: [],
  settings: [],
  schema: z.object({}),
  oauth: {
    authUrl: "https://account-d.docusign.com/oauth/auth",
    clientId: DOCUSIGN_INTEGRATION_KEY ?? "",
    redirectUri:
      DOCUSIGN_OAUTH_REDIRECT_URL ?? "/api/integrations/docusign/callback",
    scopes: ["signature", "impersonation"],
    tokenUrl: "https://account-d.docusign.com/oauth/token"
  },
  onClientInstall: async () => {
    const response = await fetch("/api/integrations/docusign/install").then(
      (res) => res.json()
    );

    const { url } = response;

    const width = 600;
    const height = 800;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2.5;

    const popup = window.open(
      url,
      "",
      `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`
    );

    if (!popup) {
      window.location.href = url;
      return;
    }

    const listener = (e: MessageEvent) => {
      if (e.data === "app_oauth_completed") {
        window.location.reload();
        window.removeEventListener("message", listener);
        popup.close();
      }
    };

    window.addEventListener("message", listener);
  }
});

function Logo() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 4C11.163 4 4 11.163 4 20s7.163 16 16 16 16-7.163 16-16S28.837 4 20 4zm0 28c-6.627 0-12-5.373-12-12S13.373 8 20 8s12 5.373 12 12-5.373 12-12 12z"
        fill="#FFCC00"
      />
      <path
        d="M20 10c-5.523 0-10 4.477-10 10s4.477 10 10 10 10-4.477 10-10-4.477-10-10-10zm4.707 7.293l-6 6a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L18 21.172l5.293-5.293a1 1 0 111.414 1.414z"
        fill="#FFCC00"
      />
    </svg>
  );
}
