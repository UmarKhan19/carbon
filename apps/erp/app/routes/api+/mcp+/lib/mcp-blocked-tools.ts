/**
 * Tools excluded from MCP discovery (tool-metadata.json) and blocked at runtime.
 * Keep this list small; add only operations that must never run via /api/mcp.
 */
export const MCP_BLOCKED_TOOL_NAMES: readonly string[] = [
  "settings_seedCompany"
];

export function isMcpBlockedTool(name: string): boolean {
  return MCP_BLOCKED_TOOL_NAMES.includes(name);
}
