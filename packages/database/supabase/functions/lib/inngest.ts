const INNGEST_EVENT_KEY = Deno.env.get("INNGEST_EVENT_KEY") ?? "";
const INNGEST_BASE_URL = Deno.env.get("INNGEST_BASE_URL");

export async function sendInngestEvent(
  name: string,
  data: Record<string, unknown>,
) {
  if (!INNGEST_BASE_URL) {
    console.warn("[inngest] INNGEST_BASE_URL not set, skipping event:", name);
    return;
  }

  const res = await fetch(`${INNGEST_BASE_URL}/e/${INNGEST_EVENT_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
  });

  if (!res.ok) {
    throw new Error(
      `Inngest event send failed: ${res.status} ${await res.text()}`,
    );
  }
}

export async function sendInngestEvents(
  events: Array<{ name: string; data: Record<string, unknown> }>,
) {
  if (!INNGEST_BASE_URL) {
    console.warn("[inngest] INNGEST_BASE_URL not set, skipping batch");
    return;
  }

  const res = await fetch(`${INNGEST_BASE_URL}/e/${INNGEST_EVENT_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(events),
  });

  if (!res.ok) {
    throw new Error(
      `Inngest batch send failed: ${res.status} ${await res.text()}`,
    );
  }
}
