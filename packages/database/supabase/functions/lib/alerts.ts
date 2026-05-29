const MAX_BLOCK_TEXT = 2500;

function truncate(text: string, max = MAX_BLOCK_TEXT) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function normalizeError(error: unknown): {
  message: string;
  stack?: string;
  rest?: Record<string, unknown>;
} {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const message =
      typeof obj.message === "string"
        ? obj.message
        : typeof obj.error === "string"
        ? obj.error
        : JSON.stringify(obj);
    const stack = typeof obj.stack === "string" ? obj.stack : undefined;
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "message" || k === "error" || k === "stack") continue;
      rest[k] = v;
    }
    return {
      message,
      stack,
      rest: Object.keys(rest).length ? rest : undefined,
    };
  }
  return { message: String(error) };
}

export async function postInternalAlert({
  source,
  error,
  context,
}: {
  source: string;
  error: unknown;
  context?: Record<string, unknown>;
}): Promise<void> {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  const channel = Deno.env.get("INTERNAL_ALERTS_SLACK_CHANNEL");
  if (!token || !channel) return;

  const env =
    Deno.env.get("SUPABASE_ENV") ?? Deno.env.get("ENVIRONMENT") ?? "unknown";
  const { message, stack, rest } = normalizeError(error);

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `:rotating_light: ${source}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Env:* ${env}\n*Error:* \`${truncate(message, 500)}\``,
      },
    },
  ];

  const mergedContext = { ...(context ?? {}), ...(rest ?? {}) };
  if (Object.keys(mergedContext).length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Context:*\n```" +
          truncate(JSON.stringify(mergedContext, null, 2)) +
          "```",
      },
    });
  }

  if (stack) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Stack:*\n```" + truncate(stack) + "```",
      },
    });
  }

  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: `:rotating_light: ${source} failed (${env}): ${truncate(message, 200)}`,
        blocks,
      }),
    });
  } catch (postError) {
    console.error("Failed to post internal alert to Slack:", postError);
  }
}
