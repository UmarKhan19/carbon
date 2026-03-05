import { getAppUrl, getCarbonServiceRole } from "@carbon/auth";
import type { sendEmailResendTask } from "@carbon/jobs/trigger/send-email-resend";
import { tasks } from "@trigger.dev/sdk";
import { tool } from "ai";
import { LuMailPlus } from "react-icons/lu";
import { z } from "zod";
import {
  getSupplierContact,
  updatePurchasingRFQStatus,
  upsertPurchasingRFQ,
  upsertPurchasingRFQLine,
  upsertPurchasingRFQSuppliers,
  upsertSupplierQuote,
  upsertSupplierQuoteLine
} from "~/modules/purchasing";
import { getCompany, getNextSequence } from "~/modules/settings";
import { getUser } from "~/modules/users/users.server";
import { path } from "~/utils/path";
import type { ChatContext } from "../agents/shared/context";
import type { ToolConfig } from "../agents/shared/tools";

export const config: ToolConfig = {
  name: "createSupplierQuotes",
  icon: LuMailPlus,
  displayText: "Creating Supplier Quotes",
  message: "Creating RFQ and sending quote requests..."
};

export const createSupplierQuotesSchema = z.object({
  suppliers: z
    .array(
      z.object({
        supplierId: z.string(),
        contactId: z
          .string()
          .optional()
          .describe("Supplier contact ID for email sending")
      })
    )
    .min(1),
  parts: z
    .array(
      z.object({
        partId: z.string(),
        quantity: z.number().positive().default(1),
        unitOfMeasureCode: z.string().optional()
      })
    )
    .min(1),
  expirationDate: z
    .string()
    .optional()
    .describe("Quote expiration date in YYYY-MM-DD format")
});

export const createSupplierQuotesTool = tool({
  description:
    "Create a purchasing RFQ, generate supplier quotes for each supplier, and send email notifications. This is an all-in-one tool for requesting quotes from multiple suppliers.",
  inputSchema: createSupplierQuotesSchema,
  execute: async function (args, executionOptions) {
    const context = executionOptions.experimental_context as ChatContext;

    console.log(
      "[createSupplierQuotesTool] Starting with args:",
      JSON.stringify(args)
    );

    // Step 1: Create the RFQ
    const rfqSequence = await getNextSequence(
      getCarbonServiceRole(),
      "purchasingRfq",
      context.companyId
    );

    if (rfqSequence.error || !rfqSequence.data) {
      return { error: "Failed to generate RFQ sequence number" };
    }

    const rfqResult = await upsertPurchasingRFQ(context.client, {
      rfqId: rfqSequence.data,
      rfqDate: new Date().toISOString().split("T")[0],
      expirationDate: args.expirationDate,
      companyId: context.companyId,
      createdBy: context.userId
    });

    if (rfqResult.error || !rfqResult.data) {
      return { error: "Failed to create RFQ" };
    }

    const rfqId = rfqResult.data.id;

    // Step 2: Create RFQ lines (one per part)
    const items = await Promise.all(
      args.parts.map((part) =>
        context.client
          .from("item")
          .select("id, name, unitOfMeasureCode")
          .eq("id", part.partId)
          .eq("companyId", context.companyId)
          .single()
      )
    );

    for (const [index, part] of args.parts.entries()) {
      const item = items[index];
      if (!item.data) {
        console.error(`Item ${part.partId} not found, skipping`);
        continue;
      }

      const uom = part.unitOfMeasureCode ?? item.data.unitOfMeasureCode ?? "EA";

      await upsertPurchasingRFQLine(context.client, {
        purchasingRfqId: rfqId,
        itemId: part.partId,
        description: item.data.name ?? "",
        quantity: [part.quantity],
        purchaseUnitOfMeasureCode: uom,
        inventoryUnitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
        order: index,
        companyId: context.companyId,
        createdBy: context.userId
      });
    }

    // Step 3: Set suppliers on the RFQ
    await upsertPurchasingRFQSuppliers(
      context.client,
      rfqId,
      args.suppliers.map((s) => s.supplierId),
      context.companyId,
      context.userId
    );

    // Step 4: Create supplier quotes (mirrors $rfqId.finalize.tsx lines 116-217)
    const createdQuotes: Array<{
      supplierId: string;
      supplierQuoteId: string;
      supplierQuoteReadableId: string;
      quoteLink: string;
      externalLinkId: string | null;
      emailSent: boolean;
    }> = [];

    const emailsToSend: Array<{
      contactEmail: string;
      contactFirstName: string;
      supplierQuoteReadableId: string;
      externalLinkId: string;
      quoteIndex: number;
    }> = [];

    for (const [supplierIndex, supplier] of args.suppliers.entries()) {
      const sequence = await getNextSequence(
        context.client,
        "supplierQuote",
        context.companyId
      );

      if (sequence.error || !sequence.data) {
        console.error("Failed to get supplier quote sequence:", sequence.error);
        continue;
      }

      // Create the supplier quote (internally creates supplierInteraction + externalLink)
      const quoteResult = await upsertSupplierQuote(context.client, {
        supplierQuoteId: sequence.data,
        supplierQuoteType: "Purchase",
        supplierId: supplier.supplierId,
        quotedDate: new Date().toISOString().split("T")[0],
        expirationDate: args.expirationDate,
        companyId: context.companyId,
        createdBy: context.userId
      });

      if (quoteResult.error || !quoteResult.data) {
        console.error("Failed to create supplier quote:", quoteResult.error);
        continue;
      }

      const supplierQuoteId = quoteResult.data.id;

      // Create quote lines for each part
      for (const [index, part] of args.parts.entries()) {
        const item = items[index];
        if (!item.data) continue;

        const uom =
          part.unitOfMeasureCode ?? item.data.unitOfMeasureCode ?? "EA";

        await upsertSupplierQuoteLine(context.client, {
          supplierQuoteId,
          itemId: part.partId,
          description: item.data.name ?? "",
          quantity: [part.quantity],
          inventoryUnitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
          purchaseUnitOfMeasureCode: uom,
          conversionFactor: 1,
          companyId: context.companyId,
          createdBy: context.userId
        });
      }

      // Link RFQ to supplier quote
      await context.client.from("purchasingRfqToSupplierQuote").insert({
        purchasingRfqId: rfqId,
        supplierQuoteId,
        companyId: context.companyId
      });

      // Get the external link ID from the created quote
      const quoteWithLink = await context.client
        .from("supplierQuote")
        .select("externalLinkId")
        .eq("id", supplierQuoteId)
        .single();

      const externalLinkId = quoteWithLink.data?.externalLinkId ?? null;

      createdQuotes.push({
        supplierId: supplier.supplierId,
        supplierQuoteId,
        supplierQuoteReadableId: sequence.data,
        quoteLink: `${getAppUrl()}${path.to.supplierQuote(supplierQuoteId)}`,
        externalLinkId,
        emailSent: false
      });

      // Queue email if contact was provided and we have an external link
      if (supplier.contactId && externalLinkId) {
        const supplierContact = await getSupplierContact(
          context.client,
          supplier.contactId
        );

        if (supplierContact?.data?.contact?.email) {
          emailsToSend.push({
            contactEmail: supplierContact.data.contact.email,
            contactFirstName: supplierContact.data.contact.firstName ?? "there",
            supplierQuoteReadableId: sequence.data,
            externalLinkId,
            quoteIndex: supplierIndex
          });
        }
      }
    }

    if (createdQuotes.length === 0) {
      // Clean up the empty RFQ
      await context.client.from("purchasingRfq").delete().eq("id", rfqId);
      return { error: "Failed to create any supplier quotes" };
    }

    // Step 5: Update RFQ status to Requested
    await updatePurchasingRFQStatus(context.client, {
      id: rfqId,
      status: "Requested",
      updatedBy: context.userId
    });

    // Step 6: Send emails
    let emailsSent = 0;
    let emailsFailed = 0;

    if (emailsToSend.length > 0) {
      const [company, user] = await Promise.all([
        getCompany(context.client, context.companyId),
        getUser(context.client, context.userId)
      ]);

      if (company.data && user.data) {
        for (const email of emailsToSend) {
          try {
            const externalQuoteUrl = `${getAppUrl()}${path.to.externalSupplierQuote(email.externalLinkId)}`;
            const emailSubject = `Supplier Quote ${email.supplierQuoteReadableId} from ${company.data.name}`;
            const emailBody = `Hey ${email.contactFirstName},\n\nPlease provide pricing and lead time(s) for the linked quote:`;
            const emailSignature = `Thanks,\n${user.data.firstName} ${user.data.lastName}\n${company.data.name}`;

            const htmlParts = [
              emailBody.replace(/\n/g, "<br>"),
              `<br><a href="${externalQuoteUrl}">${externalQuoteUrl}</a>`,
              `<br><br>${emailSignature.replace(/\n/g, "<br>")}`
            ];

            await tasks.trigger<typeof sendEmailResendTask>(
              "send-email-resend",
              {
                to: [user.data.email, email.contactEmail],
                from: user.data.email,
                subject: emailSubject,
                html: htmlParts.join(""),
                text: `${emailBody}\n\n${externalQuoteUrl}\n\n${emailSignature}`,
                companyId: context.companyId
              }
            );

            emailsSent++;
            createdQuotes[email.quoteIndex].emailSent = true;
          } catch (err) {
            console.error("Failed to send quote email:", err);
            emailsFailed++;
          }
        }
      }
    }

    // Step 7: Return result
    return {
      rfq: {
        id: rfqId,
        rfqId: rfqSequence.data,
        link: `${getAppUrl()}${path.to.purchasingRfq(rfqId)}`
      },
      quotes: createdQuotes.map((q) => ({
        supplierId: q.supplierId,
        supplierQuoteId: q.supplierQuoteReadableId,
        link: q.quoteLink,
        emailSent: q.emailSent
      })),
      totalQuotes: createdQuotes.length,
      emailsSent,
      emailsFailed
    };
  }
});
