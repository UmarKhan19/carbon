import { describe, expect, it } from "vitest";
import eePackage from "../../../../../../package.json";
import type { SyncContext } from "../../../../core/types";
import { hashPassword } from "../credentials";
import { handleQbwcRequest, type QbwcHandlerContext } from "../handler";
import { FakeCarbonStore } from "./fake-client";

/**
 * D7 conversation tests: full SOAP-in/SOAP-out round trips through
 * handleQbwcRequest for authenticate + session lifecycle, against the
 * in-memory PostgREST stand-in (fake-client.ts).
 */

const COMPANY_ID = "company-1";
const USERNAME = `carbon-${COMPANY_ID}`;
const PASSWORD = "correct-horse-battery";
const PASSWORD_HASH = hashPassword(PASSWORD);

function soapEnvelope(
  operation: string,
  params: Record<string, string> = {}
): string {
  const paramXml = Object.entries(params)
    .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    `<soap:Body><${operation} xmlns="http://developer.intuit.com/">${paramXml}</${operation}></soap:Body></soap:Envelope>`
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The `<string>` children of a string-array result, in order. */
function stringArrayResult(soapXml: string): string[] {
  return [...soapXml.matchAll(/<string>(.*?)<\/string>/g)].map(
    (match) => match[1] ?? ""
  );
}

function scalarResult(operation: string, soapXml: string): string {
  const match = new RegExp(
    `<${operation}Result>([\\s\\S]*?)</${operation}Result>`
  ).exec(soapXml);
  return match?.[1] ?? "";
}

function makeStore(
  overrides: { active?: boolean; passwordHash?: string } = {}
): FakeCarbonStore {
  const store = new FakeCarbonStore();
  store.seed("companyIntegration", {
    id: "quickbooks-desktop",
    companyId: COMPANY_ID,
    active: overrides.active ?? true,
    updatedBy: "user-1",
    updatedAt: new Date().toISOString(),
    metadata: {
      credentials: {
        type: "webConnector",
        username: USERNAME,
        passwordHash: overrides.passwordHash ?? PASSWORD_HASH,
        ownerId: "{C1885F59-B650-49EE-93B7-CDDC31482121}",
        fileId: "{9AF40000-0000-0000-0000-000000000001}"
      }
    }
  });
  return store;
}

function makeContext(store: FakeCarbonStore): QbwcHandlerContext {
  return {
    client: store.client(),
    database: {} as SyncContext["database"],
    now: () => new Date()
  };
}

function seedPendingOperation(store: FakeCarbonStore, id: string) {
  return store.seed("accountingSyncOperation", {
    id,
    companyId: COMPANY_ID,
    integration: "quickbooks-desktop",
    entityType: "invoice",
    entityId: `entity-${id}`,
    direction: "push-to-accounting",
    trigger: "event",
    status: "Pending",
    idempotencyKey: `key-${id}`
  });
}

async function authenticate(
  ctx: QbwcHandlerContext,
  username = USERNAME,
  password = PASSWORD
): Promise<string[]> {
  const { soapXml } = await handleQbwcRequest(
    soapEnvelope("authenticate", {
      strUserName: username,
      strPassword: password
    }),
    ctx
  );
  return stringArrayResult(soapXml);
}

describe("authenticate", () => {
  it("answers nvu for a bad password (full SOAP round trip)", async () => {
    const store = makeStore();
    seedPendingOperation(store, "op-1");
    const ctx = makeContext(store);

    const { soapXml } = await handleQbwcRequest(
      soapEnvelope("authenticate", {
        strUserName: USERNAME,
        strPassword: "wrong-password"
      }),
      ctx
    );

    expect(soapXml).toContain(
      '<authenticateResponse xmlns="http://developer.intuit.com/">'
    );
    expect(stringArrayResult(soapXml)).toEqual(["", "nvu"]);
    expect(store.rows("qbwcSession")).toHaveLength(0);
  });

  it("answers nvu for unknown usernames, foreign prefixes and inactive integrations", async () => {
    const inactive = makeContext(makeStore({ active: false }));
    expect(await authenticate(inactive)).toEqual(["", "nvu"]);

    const missing = makeContext(new FakeCarbonStore());
    expect(await authenticate(missing)).toEqual(["", "nvu"]);

    const ctx = makeContext(makeStore());
    expect(await authenticate(ctx, "quickbooks-user")).toEqual(["", "nvu"]);
    expect(await authenticate(ctx, "carbon-")).toEqual(["", "nvu"]);
    expect(await authenticate(ctx, "carbon-other-company")).toEqual([
      "",
      "nvu"
    ]);
  });

  it("answers none (and opens NO session) when there is no pending work", async () => {
    const store = makeStore();
    const ctx = makeContext(store);

    expect(await authenticate(ctx)).toEqual(["", "none"]);
    expect(store.rows("qbwcSession")).toHaveLength(0);
  });

  it("returns a ticket with an empty company-file element when work is pending", async () => {
    const store = makeStore();
    seedPendingOperation(store, "op-1");
    const ctx = makeContext(store);

    const result = await authenticate(ctx);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe("");

    const ticket = result[0];
    expect(ticket).toBeTruthy();
    const session = store.find("qbwcSession", ticket ?? "");
    expect(session).toMatchObject({
      companyId: COMPANY_ID,
      integration: "quickbooks-desktop",
      status: "Open",
      createdBy: "user-1"
    });
  });

  it("returns a ticket for an interrupted batch even with zero pending operations", async () => {
    const store = makeStore();
    store.seed("qbwcSession", {
      id: "qbwc-dead",
      companyId: COMPANY_ID,
      integration: "quickbooks-desktop",
      status: "Error",
      currentMessageSetId: "11111111-1111-4111-8111-111111111111",
      claimedOperationIds: ["op-1"],
      errorMessage: "QBWC crashed",
      createdBy: "user-1"
    });
    const ctx = makeContext(store);

    const result = await authenticate(ctx);
    expect(result[1]).toBe("");
    expect(result[0]).toBeTruthy();
  });
});

describe("session lifecycle operations", () => {
  it("serverVersion returns the @carbon/ee package version", async () => {
    const ctx = makeContext(makeStore());
    const { soapXml } = await handleQbwcRequest(
      soapEnvelope("serverVersion"),
      ctx
    );
    expect(scalarResult("serverVersion", soapXml)).toBe(eePackage.version);
  });

  it("clientVersion accepts any Web Connector version", async () => {
    const ctx = makeContext(makeStore());
    const { soapXml } = await handleQbwcRequest(
      soapEnvelope("clientVersion", { strVersion: "2.3.0.36" }),
      ctx
    );
    expect(scalarResult("clientVersion", soapXml)).toBe("");
  });

  it("getLastError answers NoOp for an open session with no stored error", async () => {
    const store = makeStore();
    seedPendingOperation(store, "op-1");
    const ctx = makeContext(store);

    const [ticket] = await authenticate(ctx);
    const { soapXml } = await handleQbwcRequest(
      soapEnvelope("getLastError", { ticket: ticket ?? "" }),
      ctx
    );
    expect(scalarResult("getLastError", soapXml)).toBe("NoOp");
  });

  it("closeConnection closes the session row and confirms", async () => {
    const store = makeStore();
    seedPendingOperation(store, "op-1");
    const ctx = makeContext(store);

    const [ticket] = await authenticate(ctx);
    const { soapXml } = await handleQbwcRequest(
      soapEnvelope("closeConnection", { ticket: ticket ?? "" }),
      ctx
    );

    expect(scalarResult("closeConnection", soapXml)).toBe("Sync complete");
    const session = store.find("qbwcSession", ticket ?? "");
    expect(session?.status).toBe("Closed");
    expect(session?.closedAt).toBeTruthy();
  });

  it("connectionError marks the session Error, keeps its batch and answers DONE", async () => {
    const store = makeStore();
    seedPendingOperation(store, "op-1");
    const ctx = makeContext(store);

    const [ticket] = await authenticate(ctx);
    // simulate an in-flight batch the recovery scan must find later
    const session = store.find("qbwcSession", ticket ?? "");
    if (session) {
      session.currentMessageSetId = "22222222-2222-4222-8222-222222222222";
      session.claimedOperationIds = ["op-1"];
    }

    const { soapXml } = await handleQbwcRequest(
      soapEnvelope("connectionError", {
        ticket: ticket ?? "",
        hresult: "0x8004040A",
        message: "The company file is already open"
      }),
      ctx
    );

    expect(scalarResult("connectionError", soapXml)).toBe("DONE");
    expect(session?.status).toBe("Error");
    expect(session?.errorMessage).toBe("The company file is already open");
    // closeSession must NOT clear the batch — it is the recovery marker
    expect(session?.claimedOperationIds).toEqual(["op-1"]);
  });

  it("answers a SOAP Fault for unknown operations", async () => {
    const ctx = makeContext(makeStore());
    const { soapXml } = await handleQbwcRequest(
      soapEnvelope("interactiveDone", { ticket: "qbwc-1" }),
      ctx
    );

    expect(soapXml).toContain("<soap:Fault>");
    expect(soapXml).toContain("<faultcode>soap:Client</faultcode>");
    expect(soapXml).toContain("Unknown QBWC operation: interactiveDone");
  });
});
