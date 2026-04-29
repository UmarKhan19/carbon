import { hashOAuthSecret, requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { ActionFunctionArgs } from "react-router";
import { createMcpServer } from "./lib/server";

async function authenticateOAuthToken(accessToken: string) {
  const serviceRole = getCarbonServiceRole();
  const tokenResult = await serviceRole
    .from("oauthToken")
    .select("userId, companyId, expiresAt, scope")
    .eq("accessToken", hashOAuthSecret(accessToken))
    .single();

  if (!tokenResult.data) {
    return null;
  }

  // Check if token has expired
  if (new Date(tokenResult.data.expiresAt) < new Date()) {
    return null;
  }

  return {
    userId: tokenResult.data.userId,
    companyId: tokenResult.data.companyId,
    scope: tokenResult.data.scope
  };
}

export async function action({ request }: ActionFunctionArgs) {
  console.log("[MCP] Received request:", {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries())
  });

  const authHeader = request.headers.get("Authorization");
  const hasCarbonKey = request.headers.has("carbon-key");

  // Try OAuth token authentication first for Bearer tokens
  if (authHeader?.startsWith("Bearer ") && !hasCarbonKey) {
    const token = authHeader.slice(7);

    // Check if this is an OAuth access token
    const oauthAuth = await authenticateOAuthToken(token);
    if (oauthAuth) {
      console.log("[MCP] OAuth auth successful:", {
        companyId: oauthAuth.companyId,
        userId: oauthAuth.userId
      });

      // Use service role client for OAuth-authenticated requests
      const client = getCarbonServiceRole();
      const server = createMcpServer({
        client,
        companyId: oauthAuth.companyId,
        userId: oauthAuth.userId
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      await server.connect(transport);
      console.log("[MCP] Server connected via OAuth");

      const response = await transport.handleRequest(request);

      // Add CORS headers for remote MCP clients
      const corsHeaders = new Headers(response.headers);
      corsHeaders.set("Access-Control-Allow-Origin", "*");
      corsHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      corsHeaders.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );

      return new Response(response.body, {
        status: response.status,
        headers: corsHeaders
      });
    }

    // Fall back to carbon-key auth if not an OAuth token
    const headers = new Headers(request.headers);
    headers.set("carbon-key", token);
    request = new Request(request, { headers });
    console.log("[MCP] Added carbon-key header from Bearer token");
  }

  const { client, companyId, userId } = await requirePermissions(request, {});
  console.log("[MCP] Auth successful:", { companyId, userId });

  const server = createMcpServer({ client, companyId, userId });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
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

  // Add CORS headers for remote MCP clients
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  responseHeaders.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

export async function loader({ request }: { request: Request }) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null
    }),
    {
      status: 405,
      headers: corsHeaders
    }
  );
}
