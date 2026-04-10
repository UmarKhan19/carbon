import { requirePermissions } from "@carbon/auth/auth.server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ActionFunctionArgs } from "react-router";
import { createMcpServer } from "./lib/server";

export async function action({ request }: ActionFunctionArgs) {
  const authHeader = request.headers.get("Authorization");
  const hasCarbonKey = request.headers.has("carbon-key");

  if (authHeader?.startsWith("Bearer ") && !hasCarbonKey) {
    const token = authHeader.slice(7);
    const headers = new Headers(request.headers);
    headers.set("carbon-key", token);
    request = new Request(request, { headers });
  }

  const { client, companyId, userId } = await requirePermissions(request, {});

  const server = createMcpServer({ client, companyId, userId });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  await server.connect(transport);

  return transport.handleRequest(request);
}

export async function loader() {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null
    }),
    {
      status: 405,
      headers: { "Content-Type": "application/json" }
    }
  );
}
