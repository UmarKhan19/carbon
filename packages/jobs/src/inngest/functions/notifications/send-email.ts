import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Email as EmailConfig } from "@carbon/ee";
import { NonRetriableError, serializeError } from "inngest";
import { Resend } from "resend";
import { inngest } from "../../client";

export const sendEmailFunction = inngest.createFunction(
  {
    id: "send-email",
    retries: 3
  },
  { event: "carbon/send-email" },
  async ({ event, step }) => {
    const payload = event.data;
    const serviceRole = getCarbonServiceRole();
    const jobLog = `[send-email job ${event.id ?? "?"}]`;

    console.log(`${jobLog} payload received`, {
      companyId: payload.companyId,
      from: payload.from,
      to: payload.to,
      cc: payload.cc,
      subject: payload.subject,
      attachmentCount: Array.isArray(payload.attachments)
        ? payload.attachments.length
        : 0,
      attachmentSpec: Array.isArray(payload.attachments)
        ? payload.attachments.map((a: any) => ({
            filename: a?.filename,
            hasPath: !!a?.path,
            hasContent: !!a?.content,
            pathPreview:
              typeof a?.path === "string" ? a.path.slice(0, 80) : undefined
          }))
        : undefined,
      htmlLength: typeof payload.html === "string" ? payload.html.length : 0,
      textLength: typeof payload.text === "string" ? payload.text.length : 0
    });

    const sanitizeRecipients = (
      value: string | string[] | undefined
    ): string | string[] | undefined => {
      if (Array.isArray(value)) {
        const filtered = value.filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.length > 0
        );
        return filtered.length ? filtered : undefined;
      }
      return value && typeof value === "string" ? value : undefined;
    };

    const toRecipients = sanitizeRecipients(payload.to);
    const ccRecipients = sanitizeRecipients(payload.cc);

    if (!toRecipients) {
      console.error(`${jobLog} aborting — no valid 'to' recipients`);
      throw new NonRetriableError(
        "send-email called without any valid `to` recipients"
      );
    }

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
            .eq("id", "email")
            .maybeSingle()
        ]);

        return {
          companyName: companyResult.data?.name ?? null,
          integrationActive: integrationResult.data?.active ?? false,
          integrationMetadata: integrationResult.data?.metadata ?? null
        };
      });

    // Legacy installs predate the provider field — default them to Resend so
    // existing configs keep working without any migration step on the caller.
    const metadataWithProvider =
      integrationMetadata && typeof integrationMetadata === "object"
        ? {
            provider: "resend",
            ...(integrationMetadata as Record<string, unknown>)
          }
        : integrationMetadata;

    const parsedMetadata = EmailConfig.schema.safeParse(metadataWithProvider);

    console.log(`${jobLog} integration status`, {
      companyName,
      integrationActive,
      metadataParsed: parsedMetadata.success,
      provider:
        parsedMetadata.success && "provider" in parsedMetadata.data
          ? parsedMetadata.data.provider
          : null,
      validationIssues: parsedMetadata.success
        ? undefined
        : parsedMetadata.error.issues
    });

    if (!parsedMetadata.success || !integrationActive) {
      console.error(`${jobLog} integration invalid or inactive — aborting`, {
        integrationActive,
        parseSuccess: parsedMetadata.success
      });
      return { success: false, message: "Invalid or inactive integration" };
    }

    const data = parsedMetadata.data as {
      provider: "resend" | "smtp";
      fromEmail: string;
      apiKey?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      secure?: boolean;
    };

    const fromAddress = `${companyName} <${data.fromEmail}>`;

    if (data.provider === "smtp") {
      const result = await step.run("send-email", async () => {
        const nodemailer = await import("nodemailer");
        const transporter = nodemailer.createTransport({
          host: data.host!,
          port: data.port!,
          secure: data.secure === true,
          auth: {
            user: data.username!,
            pass: data.password!
          }
        });

        console.info(`SMTP Email Job`);
        return transporter.sendMail({
          from: fromAddress,
          to: toRecipients,
          cc: ccRecipients,
          replyTo: payload.from,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          attachments: payload.attachments?.map(
            (a: { filename: string; content: string }) => ({
              filename: a.filename,
              content: a.content,
              encoding: "base64" as const
            })
          )
        });
      });

      return { success: true, result };
    }

    const result = await step.run("send-email", async () => {
      const resend = new Resend(data.apiKey!);

      const email = {
        from: fromAddress,
        to: toRecipients,
        cc: ccRecipients,
        reply_to: payload.from,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        attachments: payload.attachments
      };

      console.log(`${jobLog} calling Resend`, {
        from: email.from,
        to: email.to,
        cc: email.cc,
        replyTo: email.reply_to,
        subject: email.subject,
        attachmentCount: Array.isArray(email.attachments)
          ? email.attachments.length
          : 0,
        apiKeyPresent: !!data.apiKey,
        apiKeyPrefix: data.apiKey ? `${data.apiKey.slice(0, 6)}...` : null
      });

      const response = await resend.emails.send(email);

      if (response.error) {
        console.error(`${jobLog} Resend returned error`, {
          name: response.error.name,
          message: response.error.message,
          fullError: serializeError(response.error)
        });
        if (response.error.name === "validation_error") {
          throw new NonRetriableError(
            `Resend validation error: ${serializeError(response.error)}`
          );
        }
        throw new Error(`Resend error: ${serializeError(response.error)}`);
      }

      console.log(`${jobLog} Resend accepted`, { id: response.data?.id });
      return response.data;
    });

    return { success: true, result };
  }
);
