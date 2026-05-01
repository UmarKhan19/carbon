import { GTM_EVENTS_API_SECRET_KEY, GTM_URL } from "@carbon/auth";

export async function forwardToGtm(
  type: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (!GTM_URL || !GTM_EVENTS_API_SECRET_KEY) return;

  const res = await fetch(`${GTM_URL}/api/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gtm-events-key": GTM_EVENTS_API_SECRET_KEY
    },
    body: JSON.stringify({ type, metadata }),
    signal: AbortSignal.timeout(5000)
  });

  if (!res.ok) {
    throw new Error(
      `[gtm-events] ${res.status}: ${await res.text().catch(() => "")}`
    );
  }
}
