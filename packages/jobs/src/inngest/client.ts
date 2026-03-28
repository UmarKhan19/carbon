import { EventSchemas, Inngest } from "inngest";
import type { EventSendPayload, Events } from "../events.ts";

/**
 * The Inngest client for Carbon jobs.
 * This client is used to define functions and send events.
 */
export const inngest = new Inngest({
  id: "carbon",
  schemas: new EventSchemas().fromRecord<Events>()
});

// Re-export the typed client for use in functions
export type InngestClient = typeof inngest;

/**
 * Typed send wrapper — single boundary between our Events type and the
 * Inngest SDK's generic send method.
 *
 * All event sending should go through this function so the `as any` cast
 * (needed because TS cannot prove structural equivalence between our
 * Events-derived union and Inngest's schema-derived SendEventPayload)
 * is contained to one place.
 */
export function send(
  payload: EventSendPayload | EventSendPayload[]
): ReturnType<typeof inngest.send> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return inngest.send(payload as any);
}

// Helper for type-safe event sending
export async function sendEvent<K extends keyof Events>(
  name: K,
  data: Events[K]["data"]
) {
  return send({ name, data } as EventSendPayload);
}

// Helper for batch sending events
export async function sendEvents<K extends keyof Events>(
  events: Array<{ name: K; data: Events[K]["data"] }>
) {
  return send(
    events.map((e) => ({ name: e.name, data: e.data }) as EventSendPayload)
  );
}
