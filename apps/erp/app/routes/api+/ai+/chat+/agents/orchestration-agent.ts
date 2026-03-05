import { openai } from "@ai-sdk/openai";
import { purchasingAgent } from "./purchasing-agent";
import { searchAgent } from "./search-agent";
import { createAgent } from "./shared/agent";
import { formatContextForLLM } from "./shared/prompts";
import type { AgentConfig } from "./shared/tools";

export const config: AgentConfig = {
  name: "triage",
  displayName: "Triage Agent",
  description: "Routes user requests to the appropriate specialist",
  executingMessage: "Thinking..."
};

export const orchestrationAgent = createAgent({
  name: "triage",
  model: openai("gpt-4o"),
  temperature: 0.1,
  modelSettings: {
    toolChoice: {
      type: "tool",
      toolName: "handoff_to_agent"
    }
  },
  instructions: (ctx) => `Route user requests to the appropriate specialist.

<background-data>
${formatContextForLLM(ctx)}

<agent-capabilities>
general: General questions, greetings, web search
parts: Search for parts by description or readable ID
suppliers: Search for suppliers, find suppliers for parts
purchasing: creating purchase orders, requesting quotes from multiple suppliers, sending quote emails
</agent-capabilities>
</background-data>`,
  handoffs: [purchasingAgent, searchAgent],
  maxTurns: 1
});
