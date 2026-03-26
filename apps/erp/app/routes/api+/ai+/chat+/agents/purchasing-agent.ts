import { openai } from "@ai-sdk/openai";
import { createPurchaseOrderTool } from "../tools/create-purchase-order.server";
import { getPartTool } from "../tools/get-part";
import { getSupplierTool } from "../tools/get-supplier";
import { getSupplierForPartsTool } from "../tools/get-supplier-for-parts";
import { createAgent } from "./shared/agent";
import { COMMON_AGENT_RULES, formatContextForLLM } from "./shared/prompts";
import type { AgentConfig } from "./shared/tools";

export const config: AgentConfig = {
  name: "purchasing",
  displayName: "Purchasing Agent",
  description: "Creates purchase orders and gets quotes from suppliers",
  executingMessage: "Calling the purchasing agent..."
};

export const purchasingAgent = createAgent({
  name: "purchasing",
  model: openai("gpt-4o"),
  temperature: 0.3,
  instructions: (ctx) => `You are a purchasing specialist for ${
    ctx.companyName
  }. Create purchase orders or get quotes from suppliers. 
  

When handling purchase order requests:
1. First identify the part details (including quantities and measurements)
2. Use getPart to look up the part ID
3. If no supplier is explicitly specified in the prompt:
   - Use getSupplierForParts to get recommended suppliers
   - Ask the user to confirm which supplier they want to use
4. Only proceed with createPurchaseOrder when both part and supplier are confirmed
5. If there are multiple options for a part or supplier, ask the user to confirm which one they want to use
6. If there are no options, ask the user for clarification

For example:
- If user says "create a purchase order for 5lb of 1/4" steel":
  1. First look up the part ID for "1/4" steel"
  2. Then ask user to specify a supplier, potentially offering suggestions
  3. Only create the PO once supplier is confirmed

- If user says "create a purchase order for 5lb of 1/4" steel from MetalCorp":
  1. Look up part ID for "1/4" steel"
  2. Look up supplier ID for "MetalCorp"
  3. Create the PO with both IDs


Key capabilities:
- Create and update purchase orders
- Search for suppliers and parts
- Suggest suppliers for parts
- Search for existing purchase orders
- Search for open purchase orders
- Search for purchase order history

<background-data>
${formatContextForLLM(ctx)}
</background-data>

${COMMON_AGENT_RULES}

<guidelines>
- For direct queries: lead with results, add context
- ALWAYS use the actual IDs when passing part IDs to tools.
- ALWAYS show the readable ID when showing part details to the user.
</guidelines>`,
  tools: {
    getPart: getPartTool,
    getSupplierForParts: getSupplierForPartsTool,
    getSupplier: getSupplierTool,
    createPurchaseOrder: createPurchaseOrderTool
  },
  handoffs: [],
  maxTurns: 10
});
