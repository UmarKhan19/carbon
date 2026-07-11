/**
 * QuickBooks Web Connector SOAP endpoint (Task D9).
 *
 * URL: /api/integrations/quickbooks-desktop/qbwc — this MUST match the
 * QBWC_ENDPOINT_PATH constant the .qwc generator bakes into the file's
 * AppURL (x+/settings+/integrations.$id.qwc.tsx). QBWC polls this endpoint
 * with the eight SOAP operations; the protocol state machine lives in
 * @carbon/ee (handleQbwcRequest is transport-pure — this route owns HTTP
 * and nothing else).
 *
 * No requirePermissions: the QBWC handshake IS the auth (authenticate
 * verifies the scrypt-hashed connection password against the
 * companyIntegration credentials; every later call carries the session
 * ticket). Same raw-body/service-role pattern as webhook.xero.ts. Wrong
 * passwords answer "nvu" inside the protocol; the rate limit below is the
 * brute-force backstop.
 *
 * QBWC is not a browser: no CORS, and errors must NEVER surface as HTML
 * error pages — every failure path answers a SOAP Fault (or short plain
 * text for non-SOAP requests).
 */

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  buildQbwcSoapFault,
  handleQbwcRequest
} from "@carbon/ee/accounting/qbwc";
import { Ratelimit, redis } from "@carbon/kv";
import type { ActionFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";

// Node runtime: the QBWC handler verifies scrypt password hashes via
// node:crypto (webhook.xero.ts precedent for the config export)
export const config = {
  runtime: "nodejs"
};

/**
 * 30 requests/minute per client. The Web Connector's serial loop (one
 * request in flight, 5s pauses on NoOp) stays far below this; a
 * brute-force password sweep does not.
 */
const REQUESTS_PER_MINUTE = 30;

const soapHeaders = { "Content-Type": "text/xml; charset=utf-8" };

function soapResponse(soapXml: string, status = 200): Response {
  return new Response(soapXml, { status, headers: soapHeaders });
}

/** QBWC only POSTs; a GET is a human (or a scanner) poking the URL. */
export async function loader() {
  return new Response("QuickBooks Web Connector endpoint", {
    status: 405,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/xml")) {
      return new Response("Unsupported media type: expected text/xml", {
        status: 415,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    const soapXml = await request.text();

    // Rate-limit key: client IP (first x-forwarded-for hop) plus the SOAP
    // username when it is cheaply extractable (authenticate calls carry
    // it; the work-loop calls only carry the session ticket).
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const username =
      /<strUserName>([^<]{1,120})<\/strUserName>/.exec(soapXml)?.[1] ?? "";

    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(REQUESTS_PER_MINUTE, "1 m"),
      analytics: true
    });
    const { success } = await ratelimit.limit(
      `qbwc:${ip}${username ? `:${username}` : ""}`
    );

    if (!success) {
      return soapResponse(
        buildQbwcSoapFault(
          "Client",
          "Rate limit exceeded — the QuickBooks Web Connector should retry on its next scheduled run"
        ),
        429
      );
    }

    // handleQbwcRequest never throws: protocol-level problems come back as
    // SOAP Faults inside result.soapXml with status 200 (QBWC reads the
    // fault body, not the status).
    const result = await handleQbwcRequest(soapXml, {
      client: getCarbonServiceRole(),
      database: getDatabaseClient(),
      now: () => new Date()
    });

    return soapResponse(result.soapXml);
  } catch (error) {
    // Transport-level failures (body read, Redis, unexpected bugs) — never
    // leak an HTML error page at the Web Connector.
    console.error("QBWC endpoint failed:", error);
    return soapResponse(
      buildQbwcSoapFault(
        "Server",
        error instanceof Error ? error.message : "Unexpected server error"
      ),
      500
    );
  }
}
