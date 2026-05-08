import { getSlackClient } from "@carbon/lib/slack.server";
import { inngest } from "../../client";

export const sendSlackFunction = inngest.createFunction(
  {
    id: "send-slack",
    retries: 3
  },
  { event: "carbon/send-slack" },
  async ({ event, step }) => {
    const { channel, text, blocks } = event.data;

    await step.run("post-message", async () => {
      const slack = getSlackClient();
      // Slack client is a no-op on localhost (see slack.server.ts).
      await slack.sendMessage({ blocks, channel, text });
    });

    return { success: true };
  }
);
