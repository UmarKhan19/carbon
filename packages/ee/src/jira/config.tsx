import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { getJiraClient } from "./lib";

export const Jira = defineIntegration({
  name: "JIRA",
  id: "jira",
  active: true,
  category: "Project Management",
  logo: Logo,
  description:
    "JIRA is a project and issue tracking software used for agile teams. With this integration, you can link issues from Carbon to JIRA.",
  shortDescription: "Sync issues from Carbon to JIRA.",
  setupInstructions: SetupInstructions,
  images: [],
  settings: [
    {
      name: "domain",
      label: "JIRA Domain",
      type: "text",
      required: true,
      value: "",
      placeholder: "your-domain.atlassian.net"
    },
    {
      name: "email",
      label: "Email",
      type: "text",
      required: true,
      value: "",
      placeholder: "user@example.com"
    },
    {
      name: "apiToken",
      label: "API Token",
      type: "text",
      required: true,
      value: ""
    }
  ],
  onHealthcheck: healthcheck,
  schema: z.object({
    domain: z
      .string()
      .min(1, { message: "JIRA Domain is required" })
      .refine((val) => val.includes("atlassian.net"), {
        message:
          "JIRA Domain must be a valid Atlassian domain (e.g., your-domain.atlassian.net)"
      }),
    email: z
      .string()
      .min(1, { message: "Email is required" })
      .email({ message: "Email must be valid" }),
    apiToken: z.string().min(1, { message: "API Token is required" })
  })
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/jira/${companyId}`
    : "";

  return (
    <>
      <p className="text-sm text-muted-foreground">
        To integrate JIRA with Carbon, start by logging into your JIRA account
        and navigating to your Atlassian instance.
      </p>
      <p className="text-sm text-muted-foreground">
        First, enter your JIRA domain (e.g., your-domain.atlassian.net), your
        email address associated with your JIRA account, and generate an API
        token.
      </p>
      <p className="text-sm text-muted-foreground">
        To generate an API token:
        <ol className="list-decimal list-inside mt-2 ml-4">
          <li>Go to account.atlassian.com</li>
          <li>Click "Security" in the sidebar</li>
          <li>Click "Create and manage your API tokens"</li>
          <li>Click "Create API token"</li>
          <li>Give it a label and copy the token</li>
        </ol>
      </p>

      <p className="text-sm text-muted-foreground mt-4">
        Next, set up a webhook in JIRA to notify Carbon of issue updates.
      </p>
      <p className="text-sm text-muted-foreground">
        Go to your JIRA instance → Settings → Webhooks → Create a webhook.
      </p>
      <p className="text-sm text-muted-foreground">
        Copy the webhook URL below and configure it to send updates for issue
        updates.
      </p>
      <InputGroup className="mb-8">
        <Input value={webhookUrl} />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>

      <p className="text-sm text-muted-foreground">
        Configure the webhook to listen for these events: Issue Updated
      </p>
    </>
  );
}

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      width={200}
      height={200}
      viewBox="0 0 100 100"
      {...props}
    >
      <path
        fill="currentColor"
        d="M50 5a45 45 0 1 0 0 90A45 45 0 0 0 50 5zm0 84a39 39 0 1 1 0-78 39 39 0 0 1 0 78z"
      />
      <circle fill="currentColor" cx="50" cy="50" r="6" />
      <path
        fill="currentColor"
        d="M50 30a20 20 0 1 1 0 40 20 20 0 0 1 0-40z"
        opacity="0.3"
      />
    </svg>
  );
}

async function healthcheck(companyId: string, _: Record<string, unknown>) {
  const jira = getJiraClient();
  return await jira.healthcheck(companyId);
}
