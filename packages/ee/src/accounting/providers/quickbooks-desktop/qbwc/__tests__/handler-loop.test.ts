import { describe, expect, it } from "vitest";
import type { SyncContext } from "../../../../core/types";
import type {
  QbdBuildRequestResult,
  QbdOperationInput,
  QbdProcessResponseResult
} from "../../entities/shared";
import type { QbxmlResponse } from "../../qbxml/parse";
import { hashPassword } from "../credentials";
import { handleQbwcRequest, type QbwcHandlerContext } from "../handler";
import { FakeCarbonStore } from "./fake-client";

/**
 * D8 conversation tests: the sendRequestXML/receiveResponseXML work loop,
 * driven end-to-end through SOAP envelopes against the in-memory client.
 * Syncers are scripted through the handler's getSyncer seam (the real
 * registry classes need a live database); the scripts follow the D10
 * two-phase contract exactly, and every build/process call is recorded so
 * the double-post assertions can count requests.
 */

const COMPANY_ID = "company-1";
const USERNAME = `carbon-${COMPANY_ID}`;
const PASSWORD = "correct-horse-battery";
const PASSWORD_HASH = hashPassword(PASSWORD);

// /********************************************************\
// *                     SOAP plumbing                       *
// \********************************************************/

function soapEnvelope(
  operation: string,
  params: Record<string, string> = {}
): string {
  const paramXml = Object.entries(params)
    .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
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

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function scalarResult(operation: string, soapXml: string): string {
  const match = new RegExp(
    `<${operation}Result>([\\s\\S]*?)</${operation}Result>`
  ).exec(soapXml);
  return match?.[1] ?? "";
}

function stringArrayResult(soapXml: string): string[] {
  return [...soapXml.matchAll(/<string>(.*?)<\/string>/g)].map(
    (match) => match[1] ?? ""
  );
}

async function authenticate(ctx: QbwcHandlerContext): Promise<string> {
  const { soapXml } = await handleQbwcRequest(
    soapEnvelope("authenticate", {
      strUserName: USERNAME,
      strPassword: PASSWORD
    }),
    ctx
  );
  const result = stringArrayResult(soapXml);
  expect(result[1]).toBe("");
  return result[0] ?? "";
}

/** Returns the (unescaped) qbXML handed to QBWC, "" when there is none. */
async function sendRequest(
  ctx: QbwcHandlerContext,
  ticket: string
): Promise<string> {
  const { soapXml } = await handleQbwcRequest(
    soapEnvelope("sendRequestXML", {
      ticket,
      strHCPResponse: "",
      strCompanyFileName: "C:\\QB\\acme.qbw",
      qbXMLCountry: "US",
      qbXMLMajorVers: "16",
      qbXMLMinorVers: "0"
    }),
    ctx
  );
  return unescapeXml(scalarResult("sendRequestXML", soapXml));
}

/** Returns the percent-done int QBWC receives. */
async function receiveResponse(
  ctx: QbwcHandlerContext,
  ticket: string,
  response: string,
  hresult = "",
  message = ""
): Promise<number> {
  const { soapXml } = await handleQbwcRequest(
    soapEnvelope("receiveResponseXML", { ticket, response, hresult, message }),
    ctx
  );
  return Number(scalarResult("receiveResponseXML", soapXml));
}

async function getLastError(
  ctx: QbwcHandlerContext,
  ticket: string
): Promise<string> {
  const { soapXml } = await handleQbwcRequest(
    soapEnvelope("getLastError", { ticket }),
    ctx
  );
  return scalarResult("getLastError", soapXml);
}

// /********************************************************\
// *              qbXML request/response fixtures            *
// \********************************************************/

function requestIds(qbxml: string): string[] {
  return [...qbxml.matchAll(/requestID="([^"]+)"/g)].map(
    (match) => match[1] ?? ""
  );
}

function messageSetId(qbxml: string, attribute: "new" | "old"): string {
  const match = new RegExp(`${attribute}MessageSetID="([^"]+)"`).exec(qbxml);
  return match?.[1] ?? "";
}

function invoiceAddRq(requestId: string, entityId: string): string {
  return `<InvoiceAddRq requestID="${requestId}"><InvoiceAdd><Memo>Carbon ${entityId}</Memo></InvoiceAdd></InvoiceAddRq>`;
}

function customerQueryRq(requestId: string): string {
  return `<CustomerQueryRq requestID="${requestId}"><FullName>Acme Manufacturing</FullName></CustomerQueryRq>`;
}

function customerModRq(requestId: string): string {
  return `<CustomerModRq requestID="${requestId}"><CustomerMod><ListID>80000001-1</ListID></CustomerMod></CustomerModRq>`;
}

function responseSet(children: string): string {
  return `<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>${children}</QBXMLMsgsRs></QBXML>`;
}

function okRs(rqType: string, requestId: string, retXml = ""): string {
  return (
    `<${rqType}Rs requestID="${requestId}" statusCode="0" statusSeverity="Info" statusMessage="Status OK">` +
    retXml +
    `</${rqType}Rs>`
  );
}

function errorRs(
  rqType: string,
  requestId: string,
  statusCode: number,
  statusMessage: string
): string {
  return `<${rqType}Rs requestID="${requestId}" statusCode="${statusCode}" statusSeverity="Error" statusMessage="${statusMessage}" />`;
}

function invoiceOkResponses(ids: string[]): string {
  return responseSet(
    ids
      .map((id) =>
        okRs(
          "InvoiceAdd",
          id,
          `<InvoiceRet><TxnID>TXN-${id}</TxnID><EditSequence>1</EditSequence></InvoiceRet>`
        )
      )
      .join("")
  );
}

// /********************************************************\
// *                        Harness                          *
// \********************************************************/

type SyncerScript = {
  buildRequest?(
    op: QbdOperationInput
  ): QbdBuildRequestResult | Promise<QbdBuildRequestResult>;
  processResponse?(
    op: QbdOperationInput,
    response: QbxmlResponse
  ): QbdProcessResponseResult | Promise<QbdProcessResponseResult>;
};

function makeHarness(script: SyncerScript = {}) {
  const store = new FakeCarbonStore();
  store.seed("companyIntegration", {
    id: "quickbooks-desktop",
    companyId: COMPANY_ID,
    active: true,
    updatedBy: "user-1",
    updatedAt: new Date().toISOString(),
    metadata: {
      credentials: {
        type: "webConnector",
        username: USERNAME,
        passwordHash: PASSWORD_HASH,
        ownerId: "{C1885F59-B650-49EE-93B7-CDDC31482121}",
        fileId: "{9AF40000-0000-0000-0000-000000000001}"
      }
    }
  });

  const buildCalls: string[] = [];
  const processCalls: string[] = [];

  const buildRequest =
    script.buildRequest ??
    ((op: QbdOperationInput): QbdBuildRequestResult => ({
      outcome: "request",
      requestXml: invoiceAddRq(op.id, op.entityId),
      phase: "add"
    }));

  const processResponse =
    script.processResponse ??
    ((op: QbdOperationInput): QbdProcessResponseResult => ({
      outcome: "completed",
      externalId: `QB-${op.id}`,
      editSequence: null
    }));

  const ctx: QbwcHandlerContext = {
    client: store.client(),
    database: {} as SyncContext["database"],
    now: () => new Date(),
    getSyncer: () => ({
      async buildRequest(op) {
        buildCalls.push(op.id);
        return buildRequest(op);
      },
      async processResponse(op, response) {
        processCalls.push(op.id);
        return processResponse(op, response);
      }
    })
  };

  return { store, ctx, buildCalls, processCalls };
}

function seedPendingOperation(
  store: FakeCarbonStore,
  id: string,
  args: { entityType?: string; createdAt?: string } = {}
) {
  return store.seed("accountingSyncOperation", {
    id,
    companyId: COMPANY_ID,
    integration: "quickbooks-desktop",
    entityType: args.entityType ?? "invoice",
    entityId: `entity-${id}`,
    direction: "push-to-accounting",
    trigger: "event",
    status: "Pending",
    idempotencyKey: `key-${id}`,
    ...(args.createdAt ? { createdAt: args.createdAt } : {})
  });
}

/** A crashed session holding an unprocessed batch (recovery input). */
function seedInterruptedBatch(
  store: FakeCarbonStore,
  args: { messageSetId: string; operationIds: string[] }
) {
  for (const id of args.operationIds) {
    store.seed("accountingSyncOperation", {
      id,
      companyId: COMPANY_ID,
      integration: "quickbooks-desktop",
      entityType: "invoice",
      entityId: `entity-${id}`,
      direction: "push-to-accounting",
      trigger: "event",
      status: "In Flight",
      attemptCount: 1,
      lastAttemptAt: new Date().toISOString(),
      idempotencyKey: `key-${id}`,
      metadata: { qbdPhase: "add" }
    });
  }
  return store.seed("qbwcSession", {
    id: "qbwc-dead",
    companyId: COMPANY_ID,
    integration: "quickbooks-desktop",
    status: "Error",
    currentMessageSetId: args.messageSetId,
    claimedOperationIds: args.operationIds,
    errorMessage: "QBWC crashed mid-batch",
    createdBy: "user-1"
  });
}

// /********************************************************\
// *                         Tests                           *
// \********************************************************/

describe("two-batch drain", () => {
  it("drains 25 operations as 20 + 5 with the percent-done sequence 80 → 100", async () => {
    const { store, ctx } = makeHarness();
    const base = Date.now() - 60_000;
    const ids = Array.from({ length: 25 }, (_, index) => {
      const id = `op-${String(index + 1).padStart(2, "0")}`;
      seedPendingOperation(store, id, {
        createdAt: new Date(base + index * 1000).toISOString()
      });
      return id;
    });

    const ticket = await authenticate(ctx);

    // Batch 1 — FIFO by createdAt, capped at 20
    const batch1 = await sendRequest(ctx, ticket);
    expect(batch1).toContain('<?qbxml version="16.0"?>');
    expect(batch1).toContain('onError="continueOnError"');
    const batch1Ids = requestIds(batch1);
    expect(batch1Ids).toEqual(ids.slice(0, 20));
    expect(messageSetId(batch1, "new")).toBeTruthy();

    const session = store.find("qbwcSession", ticket);
    expect(session?.claimedOperationIds).toEqual(ids.slice(0, 20));
    expect(session?.currentMessageSetId).toBe(messageSetId(batch1, "new"));
    expect(session?.qbxmlMajorVersion).toBe("16");
    expect(store.find("accountingSyncOperation", "op-01")).toMatchObject({
      status: "In Flight",
      metadata: { qbdPhase: "add" }
    });

    const percent1 = await receiveResponse(
      ctx,
      ticket,
      invoiceOkResponses(batch1Ids)
    );
    expect(percent1).toBe(80); // floor(20 / 25 * 100)

    for (const id of batch1Ids) {
      expect(store.find("accountingSyncOperation", id)).toMatchObject({
        status: "Completed",
        externalId: `QB-${id}`
      });
    }
    expect(store.find("qbwcSession", ticket)?.claimedOperationIds).toBeNull();

    // Batch 2 — the remaining 5
    const batch2 = await sendRequest(ctx, ticket);
    const batch2Ids = requestIds(batch2);
    expect(batch2Ids).toEqual(ids.slice(20));
    expect(messageSetId(batch2, "new")).not.toBe(messageSetId(batch1, "new"));

    const percent2 = await receiveResponse(
      ctx,
      ticket,
      invoiceOkResponses(batch2Ids)
    );
    expect(percent2).toBe(100);

    for (const id of ids) {
      expect(store.find("accountingSyncOperation", id)?.status).toBe(
        "Completed"
      );
    }

    // Nothing left — the next request pass would end immediately
    expect(await sendRequest(ctx, ticket)).toBe("");
  });
});

describe("mixed response statuses", () => {
  it("routes 3100 to Warning, 3176 to Failed retryable, success to Completed", async () => {
    const { store, ctx } = makeHarness();
    seedPendingOperation(store, "op-a", { createdAt: "2026-07-11T10:00:00Z" });
    seedPendingOperation(store, "op-b", { createdAt: "2026-07-11T10:00:01Z" });
    seedPendingOperation(store, "op-c", { createdAt: "2026-07-11T10:00:02Z" });

    const ticket = await authenticate(ctx);
    const batch = await sendRequest(ctx, ticket);
    expect(requestIds(batch)).toEqual(["op-a", "op-b", "op-c"]);

    const percent = await receiveResponse(
      ctx,
      ticket,
      responseSet(
        errorRs("InvoiceAdd", "op-a", 3100, "The name Acme is already in use") +
          errorRs("InvoiceAdd", "op-b", 3176, "Object is in use") +
          okRs(
            "InvoiceAdd",
            "op-c",
            "<InvoiceRet><TxnID>TXN-op-c</TxnID></InvoiceRet>"
          )
      )
    );

    expect(percent).toBe(100);
    expect(store.find("accountingSyncOperation", "op-a")).toMatchObject({
      status: "Warning",
      errorCode: "NAME_EXISTS",
      errorMessage: "The name Acme is already in use"
    });
    expect(store.find("accountingSyncOperation", "op-b")).toMatchObject({
      status: "Failed",
      errorCode: "QB_BUSY"
    });
    expect(store.find("accountingSyncOperation", "op-c")).toMatchObject({
      status: "Completed",
      externalId: "QB-op-c"
    });
    expect(store.find("qbwcSession", ticket)?.claimedOperationIds).toBeNull();
  });
});

describe("hresult failure and crash recovery", () => {
  it("marks the session Error on hresult, keeps the batch, and surfaces the message via getLastError", async () => {
    const { store, ctx } = makeHarness();
    seedPendingOperation(store, "op-a", { createdAt: "2026-07-11T10:00:00Z" });
    seedPendingOperation(store, "op-b", { createdAt: "2026-07-11T10:00:01Z" });

    const ticket = await authenticate(ctx);
    const batch = await sendRequest(ctx, ticket);
    const batchIds = requestIds(batch);
    expect(batchIds).toEqual(["op-a", "op-b"]);

    const percent = await receiveResponse(
      ctx,
      ticket,
      "",
      "0x80040400",
      "QuickBooks found an error when parsing the provided XML text stream."
    );
    expect(percent).toBe(-1);

    const session = store.find("qbwcSession", ticket);
    expect(session).toMatchObject({
      status: "Error",
      errorMessage:
        "QuickBooks found an error when parsing the provided XML text stream.",
      claimedOperationIds: ["op-a", "op-b"] // preserved — the recovery marker
    });

    // Ops stay In Flight (no return-to-Pending) — the next conversation's
    // recovery probe decides whether they were written
    expect(store.find("accountingSyncOperation", "op-a")?.status).toBe(
      "In Flight"
    );

    expect(await getLastError(ctx, ticket)).toBe(
      "QuickBooks found an error when parsing the provided XML text stream."
    );
  });

  it("probes an interrupted batch with oldMessageSetID before claiming (9002 → re-send, no duplicate build)", async () => {
    const { store, ctx, buildCalls } = makeHarness();
    const oldMessageSetId = "11111111-1111-4111-8111-111111111111";
    seedInterruptedBatch(store, {
      messageSetId: oldMessageSetId,
      operationIds: ["op-a", "op-b"]
    });

    const ticket = await authenticate(ctx);

    // 1) The recovery probe: an EMPTY message set asking for the stored
    //    response — nothing is built and nothing is claimed
    const probe = await sendRequest(ctx, ticket);
    expect(probe).toBe(
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<?qbxml version="16.0"?>\n' +
        `<QBXML><QBXMLMsgsRq onError="continueOnError" oldMessageSetID="${oldMessageSetId}"></QBXMLMsgsRq></QBXML>`
    );
    expect(buildCalls).toEqual([]);

    // The batch moved onto THIS session; the dead session's marker cleared
    expect(store.find("qbwcSession", ticket)).toMatchObject({
      currentMessageSetId: oldMessageSetId,
      claimedOperationIds: ["op-a", "op-b"]
    });
    expect(
      store.find("qbwcSession", "qbwc-dead")?.claimedOperationIds
    ).toBeNull();

    // 2) 9002 = no stored response — the writes never landed
    const percent = await receiveResponse(
      ctx,
      ticket,
      '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs statusCode="9002" statusSeverity="Error" statusMessage="No stored response" /></QBXML>'
    );
    expect(percent).toBe(0); // keeps the loop alive

    // 3) The batch is re-sent under a FRESH newMessageSetID, each request
    //    built exactly once in this conversation
    const resend = await sendRequest(ctx, ticket);
    expect(requestIds(resend)).toEqual(["op-a", "op-b"]);
    expect(resend).toContain(invoiceAddRq("op-a", "entity-op-a"));
    expect(resend).toContain(invoiceAddRq("op-b", "entity-op-b"));
    const newId = messageSetId(resend, "new");
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(oldMessageSetId);
    expect(buildCalls).toEqual(["op-a", "op-b"]);

    const done = await receiveResponse(
      ctx,
      ticket,
      invoiceOkResponses(["op-a", "op-b"])
    );
    expect(done).toBe(100);
    expect(store.find("accountingSyncOperation", "op-a")?.status).toBe(
      "Completed"
    );
    expect(store.find("accountingSyncOperation", "op-b")?.status).toBe(
      "Completed"
    );
    // The double-post guard: exactly one Add was ever built per operation
    expect(buildCalls).toEqual(["op-a", "op-b"]);
  });

  it("completes from the STORED response without ever re-building a request", async () => {
    const { store, ctx, buildCalls, processCalls } = makeHarness();
    const oldMessageSetId = "22222222-2222-4222-8222-222222222222";
    seedInterruptedBatch(store, {
      messageSetId: oldMessageSetId,
      operationIds: ["op-a", "op-b"]
    });

    const ticket = await authenticate(ctx);

    const probe = await sendRequest(ctx, ticket);
    expect(probe).toContain(`oldMessageSetID="${oldMessageSetId}"`);

    // QuickBooks stored the response — the writes DID land; processing is
    // identical to a live batch and must NOT trigger any new request build
    const percent = await receiveResponse(
      ctx,
      ticket,
      invoiceOkResponses(["op-a", "op-b"])
    );
    expect(percent).toBe(100);

    expect(store.find("accountingSyncOperation", "op-a")).toMatchObject({
      status: "Completed",
      externalId: "QB-op-a"
    });
    expect(store.find("accountingSyncOperation", "op-b")).toMatchObject({
      status: "Completed",
      externalId: "QB-op-b"
    });
    expect(processCalls).toEqual(["op-a", "op-b"]);
    expect(buildCalls).toEqual([]); // the no-duplicate-Add guard
    expect(store.find("qbwcSession", ticket)?.claimedOperationIds).toBeNull();
    expect(await sendRequest(ctx, ticket)).toBe("");
  });
});

describe("needs-followup phase progression", () => {
  const listScript: SyncerScript = {
    buildRequest: (op) => {
      if (op.metadata?.qbdPhase === "mod") {
        return {
          outcome: "request",
          requestXml: customerModRq(op.id),
          phase: "mod"
        };
      }
      return {
        outcome: "request",
        requestXml: customerQueryRq(op.id),
        phase: "query"
      };
    },
    processResponse: (op, response) => {
      if (response.rqType === "CustomerQuery") {
        return { outcome: "needs-followup", nextPhase: "mod" };
      }
      return {
        outcome: "completed",
        externalId: "80000001-1",
        editSequence: "17"
      };
    }
  };

  it("walks query → mod → completed across three sendRequestXML calls", async () => {
    const { store, ctx } = makeHarness(listScript);
    seedPendingOperation(store, "op-cust", { entityType: "customer" });

    const ticket = await authenticate(ctx);

    // 1) query-before-insert; phase persisted BEFORE the send
    const first = await sendRequest(ctx, ticket);
    expect(first).toContain(customerQueryRq("op-cust"));
    expect(store.find("accountingSyncOperation", "op-cust")?.metadata).toEqual({
      qbdPhase: "query"
    });

    // query hit → the op stays In Flight and advances to mod
    const percent1 = await receiveResponse(
      ctx,
      ticket,
      responseSet(
        okRs(
          "CustomerQuery",
          "op-cust",
          "<CustomerRet><ListID>80000001-1</ListID><EditSequence>17</EditSequence></CustomerRet>"
        )
      )
    );
    expect(percent1).toBe(0); // one follow-up remaining keeps the loop alive
    expect(store.find("accountingSyncOperation", "op-cust")).toMatchObject({
      status: "In Flight",
      metadata: { qbdPhase: "mod" }
    });
    expect(store.find("qbwcSession", ticket)?.claimedOperationIds).toEqual([
      "op-cust"
    ]);

    // 2) the follow-up mod rides the session into the next request
    const second = await sendRequest(ctx, ticket);
    expect(second).toContain(customerModRq("op-cust"));

    const percent2 = await receiveResponse(
      ctx,
      ticket,
      responseSet(
        okRs(
          "CustomerMod",
          "op-cust",
          "<CustomerRet><ListID>80000001-1</ListID><EditSequence>18</EditSequence></CustomerRet>"
        )
      )
    );
    expect(percent2).toBe(100);
    expect(store.find("accountingSyncOperation", "op-cust")).toMatchObject({
      status: "Completed",
      externalId: "80000001-1"
    });

    // 3) nothing left
    expect(await sendRequest(ctx, ticket)).toBe("");
  });
});

describe("stale EditSequence retry", () => {
  const listScript: SyncerScript = {
    buildRequest: (op) => {
      if (
        op.metadata?.editSequenceRetry === true &&
        op.metadata?.qbdPhase === undefined
      ) {
        // the D10 flow: the retry flag (with no stored phase) re-queries
        // for a fresh EditSequence
        return {
          outcome: "request",
          requestXml: customerQueryRq(op.id),
          phase: "query"
        };
      }
      if (op.metadata?.qbdPhase === "query") {
        return {
          outcome: "request",
          requestXml: customerQueryRq(op.id),
          phase: "query"
        };
      }
      return {
        outcome: "request",
        requestXml: customerModRq(op.id),
        phase: "mod"
      };
    },
    processResponse: (op, response) => {
      if (response.rqType === "CustomerQuery") {
        return { outcome: "needs-followup", nextPhase: "mod" };
      }
      return {
        outcome: "completed",
        externalId: "80000001-1",
        editSequence: "19"
      };
    }
  };

  it("re-queries once on 3200 and fails on the second occurrence", async () => {
    const { store, ctx } = makeHarness(listScript);
    seedPendingOperation(store, "op-cust", { entityType: "customer" });

    const ticket = await authenticate(ctx);

    // 1) mod with the (stale) stored EditSequence
    const first = await sendRequest(ctx, ticket);
    expect(first).toContain(customerModRq("op-cust"));

    const staleRs = responseSet(
      errorRs(
        "CustomerMod",
        "op-cust",
        3200,
        "The provided edit sequence is out-of-date"
      )
    );

    // first 3200 → retry once: flag set, stored phase stripped, op stays
    // In Flight on the session
    const percent1 = await receiveResponse(ctx, ticket, staleRs);
    expect(percent1).toBe(0);
    expect(store.find("accountingSyncOperation", "op-cust")).toMatchObject({
      status: "In Flight",
      metadata: { editSequenceRetry: true }
    });
    expect(
      store.find("accountingSyncOperation", "op-cust")?.metadata?.qbdPhase
    ).toBeUndefined();

    // 2) the retry re-queries for a fresh EditSequence …
    const second = await sendRequest(ctx, ticket);
    expect(second).toContain(customerQueryRq("op-cust"));

    const percent2 = await receiveResponse(
      ctx,
      ticket,
      responseSet(
        okRs(
          "CustomerQuery",
          "op-cust",
          "<CustomerRet><ListID>80000001-1</ListID><EditSequence>19</EditSequence></CustomerRet>"
        )
      )
    );
    expect(percent2).toBe(0);

    // 3) … and mods again; a SECOND 3200 lands Failed
    const third = await sendRequest(ctx, ticket);
    expect(third).toContain(customerModRq("op-cust"));

    const percent3 = await receiveResponse(ctx, ticket, staleRs);
    expect(percent3).toBe(100);
    expect(store.find("accountingSyncOperation", "op-cust")).toMatchObject({
      status: "Failed",
      errorCode: "STALE_EDIT_SEQUENCE"
    });
    expect(store.find("qbwcSession", ticket)?.claimedOperationIds).toBeNull();
  });
});

describe("ticket validation", () => {
  it("answers an expired/unknown ticket with an empty request set and -1 on response", async () => {
    const { ctx } = makeHarness();
    expect(await sendRequest(ctx, "no-such-ticket")).toBe("");
    expect(await receiveResponse(ctx, "no-such-ticket", responseSet(""))).toBe(
      -1
    );
  });

  it("treats a session past the 30-minute expiry as gone", async () => {
    const { store, ctx } = makeHarness();
    seedPendingOperation(store, "op-a");
    store.seed("qbwcSession", {
      id: "qbwc-stale",
      companyId: COMPANY_ID,
      integration: "quickbooks-desktop",
      status: "Open",
      lastSeenAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      createdBy: "user-1"
    });

    expect(await sendRequest(ctx, "qbwc-stale")).toBe("");
  });
});
