import type { Database } from "@carbon/database";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface McpContext {
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
}

export type RegisterTools = (server: McpServer, ctx: McpContext) => void;

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

export const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
} as const;

export function toMcpResult(result: { data: unknown; error: unknown }) {
  if (result.error) {
    const message =
      typeof result.error === "object" &&
      result.error !== null &&
      "message" in result.error
        ? (result.error as { message: string }).message
        : JSON.stringify(result.error);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.data) }]
  };
}

export function withErrorHandling<T extends Record<string, unknown>>(
  handler: (params: T) => Promise<{
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }>,
  fallbackMessage: string
) {
  return async (params: T) => {
    try {
      return await handler(params);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : fallbackMessage
          }
        ],
        isError: true
      };
    }
  };
}
