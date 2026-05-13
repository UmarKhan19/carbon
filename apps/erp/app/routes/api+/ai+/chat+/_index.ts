import { requirePermissions } from "@carbon/auth/auth.server";
import { smoothStream } from "ai";
import type { ActionFunctionArgs } from "react-router";
import { orchestrationAgent } from "./agents/orchestration-agent";
import { createChatContext } from "./agents/shared/context";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId, companyId, companyGroupId } =
    await requirePermissions(request, {});

  const payload = await request.json();

  const {
    message,
    id,
    timezone,
    locale,
    agentChoice,
    toolChoice,
    country,
    city,
    fullName,
    companyName,
    baseCurrency
  } = payload;

  const context = createChatContext({
    baseCurrency,
    chatId: id,
    city,
    client,
    companyGroupId,
    companyId,
    companyName,
    country,
    fullName,
    locale,
    timezone,
    userId
  });

  return orchestrationAgent.toUIMessageStream({
    agentChoice,
    context,
    experimental_transform: smoothStream({
      chunking: "word"
    }),
    maxRounds: 5,
    maxSteps: 20,
    message,
    sendSources: true,
    strategy: "auto",
    toolChoice
  });
}
