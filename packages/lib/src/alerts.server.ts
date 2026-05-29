import { INTERNAL_ALERTS_SLACK_CHANNEL } from "@carbon/env";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { getSlackClient } from "./slack.server";

type AlertInput = {
  source: string;
  error: unknown;
  context?: Record<string, unknown>;
};

/**
 * Supabase's functions-js wraps non-2xx responses in a generic
 * FunctionsHttpError ("Edge Function returned a non-2xx status code") and
 * leaves the actual response body unread on `error.context`. Pull it out so
 * the alert message reflects what the edge function actually threw.
 */
export async function extractEdgeError(
  supabaseError: unknown
): Promise<unknown> {
  if (!(supabaseError instanceof FunctionsHttpError)) return supabaseError;
  try {
    const cloned = supabaseError.context.clone();
    const text = await cloned.text();
    try {
      return JSON.parse(text);
    } catch {
      return text || supabaseError;
    }
  } catch {
    return supabaseError;
  }
}

const MAX_BLOCK_TEXT = 2500;

function truncate(text: string, max = MAX_BLOCK_TEXT) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function resolveEnv() {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
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
      rest: Object.keys(rest).length ? rest : undefined
    };
  }
  return { message: String(error) };
}

export async function postInternalAlert({
  source,
  error,
  context
}: AlertInput): Promise<void> {
  const channel = INTERNAL_ALERTS_SLACK_CHANNEL;
  if (!channel) return;

  const env = resolveEnv();
  const { message, stack, rest } = normalizeError(error);

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `:rotating_light: ${source}` }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Env:* ${env}\n*Error:* \`${truncate(message, 500)}\``
      }
    }
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
          "```"
      }
    });
  }

  if (stack) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Stack:*\n```" + truncate(stack) + "```"
      }
    });
  }

  await getSlackClient().sendMessage({
    channel,
    text: `:rotating_light: ${source} failed (${env}): ${truncate(message, 200)}`,
    blocks
  });
}
