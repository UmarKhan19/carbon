import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { corsHeaders } from "../lib/headers.ts";

const recipientValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("group"),
    groupIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal("users"),
    userIds: z.array(z.string()),
  }),
]);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notify"),
    event: z.enum([
      "job-completed",
      "quote-assignment",
      "sales-rfq-assignment",
      "sales-order-assignment",
    ]),
    documentId: z.string(),
    companyId: z.string(),
    recipient: recipientValidator,
    from: z.string().optional(),
  }),
]);

const INNGEST_EVENT_KEY = Deno.env.get("INNGEST_EVENT_KEY") ?? "";
const INNGEST_BASE_URL =
  Deno.env.get("INNGEST_BASE_URL") ?? "https://inn.gs";

async function sendInngestEvent(name: string, data: Record<string, unknown>) {
  const res = await fetch(`${INNGEST_BASE_URL}/e/${INNGEST_EVENT_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
  });

  if (!res.ok) {
    throw new Error(`Inngest event send failed: ${res.status} ${await res.text()}`);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const validatedPayload = payloadValidator.parse(payload);
    const { type, ...data } = validatedPayload;

    console.log({
      function: "trigger",
      type,
      ...data,
    });

    switch (type) {
      case "notify": {
        await sendInngestEvent("carbon/notify", {
          companyId: data.companyId,
          documentId: data.documentId,
          event: data.event,
          recipient: data.recipient,
          from: data.from ?? "system",
        });
        break;
      }

      default:
        throw new Error(`Invalid type  ${type}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
