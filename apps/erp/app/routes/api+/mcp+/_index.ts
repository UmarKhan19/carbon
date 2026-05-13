import { requirePermissions } from "@carbon/auth/auth.server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ActionFunctionArgs } from "react-router";
import { createMcpServer } from "./lib/server";

export async function action({ request }: ActionFunctionArgs) {
  console.log("[MCP] Received request:", {
    headers: Object.fromEntries(request.headers.entries()),
    method: request.method,
    url: request.url
  });

  const authHeader = request.headers.get("Authorization");
  const hasCarbonKey = request.headers.has("carbon-key");

  if (authHeader?.startsWith("Bearer ") && !hasCarbonKey) {
    const token = authHeader.slice(7);
    const headers = new Headers(request.headers);
    headers.set("carbon-key", token);
    request = new Request(request, { headers });
    console.log("[MCP] Added carbon-key header from Bearer token");
  }

  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {});
  console.log("[MCP] Auth successful:", { companyId, userId });

  const server = createMcpServer({ client, companyGroupId, companyId, userId });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined
  });

  await server.connect(transport);
  console.log("[MCP] Server connected");

  const response = await transport.handleRequest(request);
  console.log("[MCP] Response status:", response.status);

  // Log response body for debugging
  const clonedResponse = response.clone();
  try {
    const responseBody = await clonedResponse.text();
    console.log("[MCP] Response body:", responseBody.substring(0, 500));
  } catch (_e) {
    console.log("[MCP] Could not read response body");
  }

  return response;
}

export async function loader() {
  return new Response(
    JSON.stringify({
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null,
      jsonrpc: "2.0"
    }),
    {
      headers: { "Content-Type": "application/json" },
      status: 405
    }
  );
}
