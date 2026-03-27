import { getCarbonServiceRole } from "@carbon/auth";
import { Resend as ResendConfig } from "@carbon/ee";
import { Resend } from "resend";
import { inngest } from "../../client";

export const sendEmailFunction = inngest.createFunction(
  {
    id: "send-email-resend",
    retries: 3,
  },
  { event: "carbon/send-email" },
  async ({ event, step }) => {
    const payload = event.data;
    const serviceRole = getCarbonServiceRole();

    const { company, integration } = await step.run("fetch-company-integration", async () => {
      const [companyResult, integrationResult] = await Promise.all([
        serviceRole
          .from("company")
          .select("name")
          .eq("id", payload.companyId)
          .single(),
        serviceRole
          .from("companyIntegration")
          .select("active, metadata")
          .eq("companyId", payload.companyId)
          .eq("id", "resend")
          .maybeSingle(),
      ]);

      return { company: companyResult, integration: integrationResult };
    });

    const integrationMetadata = ResendConfig.schema.safeParse(
      integration?.data?.metadata
    );

    console.info(integrationMetadata.data?.fromEmail ?? "No email found");

    if (!integrationMetadata.success || integration?.data?.active !== true) {
      return { success: false, message: "Invalid or inactive integration" };
    }

    const result = await step.run("send-email", async () => {
      const resend = new Resend(integrationMetadata.data.apiKey);

      const email = {
        from: `${company.data?.name} <${
          integrationMetadata.data.fromEmail ?? "onboarding@resend.dev"
        }>`,
        to: payload.to,
        cc: payload.cc,
        reply_to: payload.from,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        attachments: payload.attachments,
      };

      console.info(`Resend Email Job`);
      return resend.emails.send(email);
    });

    return { success: true, result };
  }
);
