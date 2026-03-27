import { EventSchemas, Inngest } from "inngest";
import type { Events } from "../events.ts";

/**
 * The Inngest client for Carbon jobs.
 * This client is used to define functions and send events.
 */
export const inngest = new Inngest({
  id: "carbon",
  schemas: new EventSchemas().fromRecord<Events>(),

  isDev: process.env.NODE_ENV === "development"
});

// Re-export the typed client for use in functions
export type InngestClient = typeof inngest;

// Helper for type-safe event sending
export async function sendEvent<K extends keyof Events>(
  name: K,
  data: Events[K]["data"]
) {
  return inngest.send({ name: name as string, data } as any);
}

// Helper for batch sending events
export async function sendEvents<K extends keyof Events>(
  events: Array<{ name: K; data: Events[K]["data"] }>
) {
  return inngest.send(
    events.map((e) => ({ name: e.name as string, data: e.data }) as any)
  );
}
