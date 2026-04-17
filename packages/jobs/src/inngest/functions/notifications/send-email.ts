import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Resend as ResendConfig } from "@carbon/ee";
import { NonRetriableError, serializeError } from "inngest";
import { Resend } from "resend";
import { inngest } from "../../client";

export const sendEmailFunction = inngest.createFunction(
  {
    id: "send-email-resend",
    retries: 3
  },
  { event: "carbon/send-email" },
  async ({ event, step }) => {
    const payload = event.data;
    const serviceRole = getCarbonServiceRole();

    const { companyName, integrationMetadata, integrationActive } =
      await step.run("fetch-company-integration", async () => {
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
            .maybeSingle()
        ]);

        return {
          companyName: companyResult.data?.name ?? null,
          integrationActive: integrationResult.data?.active ?? false,
          integrationMetadata: integrationResult.data?.metadata ?? null
        };
      });

    const parsedMetadata = ResendConfig.schema.safeParse(integrationMetadata);

    console.info(parsedMetadata.data?.fromEmail ?? "No email found");

    if (!parsedMetadata.success || !integrationActive) {
      return { success: false, message: "Invalid or inactive integration" };
    }

    const result = await step.run("send-email", async () => {
      const resend = new Resend(parsedMetadata.data.apiKey);

      const email = {
        from: `${companyName} <${
          parsedMetadata.data.fromEmail ?? "onboarding@resend.dev"
        }>`,
        to: payload.to,
        cc: payload.cc,
        reply_to: payload.from,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        attachments: payload.attachments
      };

      console.info(`Resend Email Job`);
      const response = await resend.emails.send(email);
      if (response.error) {
        if (response.error.name === "validation_error") {
          throw new NonRetriableError(
            `Resend validation error: ${serializeError(response.error)}`
          );
        }
        throw new Error(`Resend error: ${serializeError(response.error)}`);
      }
      return response.data;
    });

    return { success: true, result };
  }
);
