import type { Database } from "@carbon/database";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface McpContext {
  client: SupabaseClient<Database>;
  companyId: string;
  companyGroupId: string;
  userId: string;
}

export type RegisterTools = (server: McpServer, ctx: McpContext) => void;

export type AuthField = "companyId" | "createdBy" | "updatedBy";

export const READ_ONLY_ANNOTATIONS = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true
} as const;

export const WRITE_ANNOTATIONS = {
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
  readOnlyHint: false
} as const;

export const DESTRUCTIVE_ANNOTATIONS = {
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: false
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
      content: [{ text: message, type: "text" as const }],
      isError: true
    };
  }
  return {
    content: [{ text: JSON.stringify(result.data), type: "text" as const }]
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
      console.log(
        `[withErrorHandling] Executing handler for: ${fallbackMessage}`
      );
      const result = await handler(params);
      console.log(`[withErrorHandling] Handler completed successfully`);
      return result;
    } catch (error) {
      console.error(
        `[withErrorHandling] Error in handler (${fallbackMessage}):`,
        error
      );
      console.error(
        `[withErrorHandling] Error stack:`,
        error instanceof Error ? error.stack : "No stack"
      );
      return {
        content: [
          {
            text: error instanceof Error ? error.message : fallbackMessage,
            type: "text" as const
          }
        ],
        isError: true
      };
    }
  };
}
