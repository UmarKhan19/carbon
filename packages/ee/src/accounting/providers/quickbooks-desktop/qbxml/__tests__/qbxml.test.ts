import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isJournalEntrySyncFailure } from "../../../../core/posting";
import {
  buildIteratedQuery,
  buildMessageSet,
  buildRequestElement,
  QBXML_MAX_REQUEST_ID_LENGTH,
  xmlEscape
} from "../envelope";
import {
  classifyStatus,
  type QbxmlStatusKind,
  QbxmlValidationError
} from "../errors";
import {
  decodeQbxml,
  parseMessageSetResponse,
  parseMessageSetStatus,
  readIterator
} from "../parse";

const fixture = (name: string): Buffer =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

describe("buildMessageSet (envelope golden snapshots)", () => {
  const request =
    '<CustomerAddRq requestID="op-1"><CustomerAdd><Name>Acme</Name></CustomerAdd></CustomerAddRq>';

  it("wraps requests in the qbXML prolog + continueOnError message set", () => {
    expect(buildMessageSet({ version: "16.0", requests: [request] })).toBe(
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<?qbxml version="16.0"?>\n' +
        `<QBXML><QBXMLMsgsRq onError="continueOnError">${request}</QBXMLMsgsRq></QBXML>`
    );
  });

  it("stamps newMessageSetID on writing message sets (error recovery)", () => {
    expect(
      buildMessageSet({
        version: "16.0",
        newMessageSetID: "d34c9f2a-77b1-4d21-9c01-2e5a7f8b9c10",
        requests: [request]
      })
    ).toBe(
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<?qbxml version="16.0"?>\n' +
        '<QBXML><QBXMLMsgsRq onError="continueOnError" newMessageSetID="d34c9f2a-77b1-4d21-9c01-2e5a7f8b9c10">' +
        `${request}</QBXMLMsgsRq></QBXML>`
    );
  });

  it("builds an oldMessageSetID recovery probe (requests may be empty)", () => {
    expect(
      buildMessageSet({
        version: "13.0",
        oldMessageSetID: "d34c9f2a-77b1-4d21-9c01-2e5a7f8b9c10",
        requests: []
      })
    ).toBe(
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<?qbxml version="13.0"?>\n' +
        '<QBXML><QBXMLMsgsRq onError="continueOnError" oldMessageSetID="d34c9f2a-77b1-4d21-9c01-2e5a7f8b9c10"></QBXMLMsgsRq></QBXML>'
    );
  });

  it("rejects setting both newMessageSetID and oldMessageSetID", () => {
    expect(() =>
      buildMessageSet({
        version: "16.0",
        newMessageSetID: "a",
        oldMessageSetID: "b",
        requests: [request]
      })
    ).toThrow(/mutually exclusive/);
  });

  it("rejects a version that is not <major>.<minor>", () => {
    expect(() => buildMessageSet({ version: "", requests: [] })).toThrow(
      /Invalid qbXML version/
    );
    expect(() => buildMessageSet({ version: "16", requests: [] })).toThrow(
      /Invalid qbXML version/
    );
  });
});

describe("buildRequestElement (requestID cap)", () => {
  it("accepts exactly 50 characters and embeds the requestID", () => {
    const requestID = "x".repeat(QBXML_MAX_REQUEST_ID_LENGTH);
    expect(buildRequestElement("CustomerAddRq", requestID, "<a/>")).toBe(
      `<CustomerAddRq requestID="${requestID}"><a/></CustomerAddRq>`
    );
  });

  it("rejects 51 characters (SDK caps requestID at 50)", () => {
    expect(() =>
      buildRequestElement("CustomerAddRq", "x".repeat(51), "")
    ).toThrow(/caps requestID at 50/);
  });

  it("rejects an empty requestID", () => {
    expect(() => buildRequestElement("CustomerAddRq", "", "")).toThrow(
      /non-empty/
    );
  });
});

describe("xmlEscape", () => {
  it("escapes all five XML special characters", () => {
    expect(xmlEscape(`R&D <"Tools"> 'Co'`)).toBe(
      "R&amp;D &lt;&quot;Tools&quot;&gt; &apos;Co&apos;"
    );
  });
});

describe("parseMessageSetResponse", () => {
  it("parses a CustomerAddRs success with its CustomerRet payload", () => {
    const responses = parseMessageSetResponse(
      fixture("customer-add-success.xml")
    );

    expect(responses).toHaveLength(1);
    const response = responses[0]!;
    expect(response.requestID).toBe("op-cust-1");
    expect(response.rqType).toBe("CustomerAdd");
    expect(response.statusCode).toBe(0);
    expect(response.statusSeverity).toBe("Info");
    expect(response.statusMessage).toBe("Status OK");

    const payload = response.payload as Record<string, unknown>;
    expect(payload.ListID).toBe("80000001-1234567890");
    // Leaves stay strings — EditSequence must never be number-coerced
    expect(payload.EditSequence).toBe("1739717559");
    expect(payload.Balance).toBe("0.00");
    expect(payload.FullName).toBe("Acme Manufacturing");
  });

  it("parses a 3100 failure with a null payload", () => {
    const responses = parseMessageSetResponse(
      fixture("customer-add-name-exists.xml")
    );

    expect(responses).toHaveLength(1);
    const response = responses[0]!;
    expect(response.requestID).toBe("op-cust-2");
    expect(response.statusCode).toBe(3100);
    expect(response.statusSeverity).toBe("Error");
    expect(response.statusMessage).toContain("already in use");
    expect(response.payload).toBeNull();
  });

  it("preserves document order across interleaved response types and matches requestIDs", () => {
    const responses = parseMessageSetResponse(
      fixture("multi-response-order.xml")
    );

    expect(responses.map((response) => response.requestID)).toEqual([
      "op-1",
      "op-2",
      "op-3"
    ]);
    expect(responses.map((response) => response.rqType)).toEqual([
      "CustomerAdd",
      "InvoiceAdd",
      "CustomerAdd"
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      0, 0, 3100
    ]);

    const invoice = responses[1]!.payload as Record<string, unknown>;
    expect(invoice.TxnID).toBe("5D21-1622994339");
    expect(invoice.Memo).toBe("Carbon SI000042 slsinv_9f3k2m");
  });

  it("reads iterator attributes and returns a multi-Ret payload as an array", () => {
    const responses = parseMessageSetResponse(
      fixture("iterator-continuation.xml")
    );

    expect(responses).toHaveLength(1);
    const response = responses[0]!;
    expect(readIterator(response)).toEqual({
      iteratorID: "{ce85f3f2-8cca-4d06-a22c-6318d364d001}",
      remainingCount: 142
    });

    const payload = response.payload as Array<Record<string, unknown>>;
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(2);
    expect(payload[0]?.ListID).toBe("80000001-1111111111");
    expect(payload[1]?.ListID).toBe("80000002-2222222222");
  });

  it("readIterator defaults to no iterator on a plain response", () => {
    const responses = parseMessageSetResponse(
      fixture("customer-add-success.xml")
    );
    expect(readIterator(responses[0]!)).toEqual({
      iteratorID: null,
      remainingCount: 0
    });
  });

  it("re-decodes a windows-1252 response so the curly quote survives (Buffer input)", () => {
    const bytes = fixture("windows-1252-status.xml");
    // Guard: the checked-in fixture must still carry the raw 0x92 byte
    expect(bytes.includes(0x92)).toBe(true);

    const responses = parseMessageSetResponse(bytes);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.statusMessage).toContain("Widget’s Kit");
    expect(responses[0]!.statusCode).toBe(3140);
  });

  it("re-decodes a windows-1252 response handed over as a latin1 string", () => {
    const latin1String = fixture("windows-1252-status.xml").toString("latin1");
    // Upstream latin1 decoding leaves the C1 control U+0092, not a quote
    expect(latin1String).toContain("\u0092");

    const responses = parseMessageSetResponse(latin1String);
    expect(responses[0]!.statusMessage).toContain("Widget’s Kit");
  });

  it("decodeQbxml passes plain UTF-8 through untouched", () => {
    const xml = '<?xml version="1.0" encoding="utf-8"?><QBXML></QBXML>';
    expect(decodeQbxml(xml)).toBe(xml);
    expect(decodeQbxml(Buffer.from(xml, "utf8"))).toBe(xml);
  });

  it("throws on a document without a QBXML message set", () => {
    expect(() => parseMessageSetResponse("<html></html>")).toThrow(
      /missing <QBXML>/
    );
    expect(() => parseMessageSetResponse("<QBXML></QBXML>")).toThrow(
      /missing <QBXMLMsgsRs>/
    );
  });
});

describe("parseMessageSetStatus (message-set-level attributes)", () => {
  it("returns null statusCode when the message set carries no status", () => {
    const status = parseMessageSetStatus(fixture("customer-add-success.xml"));
    expect(status.statusCode).toBeNull();
    expect(status.statusSeverity).toBeNull();
  });

  it("surfaces a 9002 no-stored-response recovery status", () => {
    const xml =
      '<?xml version="1.0" ?><QBXML><QBXMLMsgsRs statusCode="9002" statusSeverity="Error" statusMessage="The oldMessageSetID does not match any stored response."></QBXMLMsgsRs></QBXML>';
    const status = parseMessageSetStatus(xml);
    expect(status.statusCode).toBe(9002);
    expect(status.statusSeverity).toBe("Error");
    expect(status.statusMessage).toContain("oldMessageSetID");
    // The document has no per-request responses in this case
    expect(parseMessageSetResponse(xml)).toEqual([]);
  });
});

describe("buildIteratedQuery", () => {
  it("opens an iterator with MaxReturned first, then the filters", () => {
    expect(
      buildIteratedQuery(
        "CustomerQueryRq",
        "<ActiveStatus>All</ActiveStatus>",
        {
          iterator: "Start",
          maxReturned: 100,
          requestID: "op-query-1"
        }
      )
    ).toBe(
      '<CustomerQueryRq requestID="op-query-1" iterator="Start"><MaxReturned>100</MaxReturned><ActiveStatus>All</ActiveStatus></CustomerQueryRq>'
    );
  });

  it("continues an iterator with the echoed iteratorID", () => {
    expect(
      buildIteratedQuery("CustomerQueryRq", "", {
        iterator: "Continue",
        iteratorID: "{ce85f3f2-8cca-4d06-a22c-6318d364d001}",
        maxReturned: 100
      })
    ).toBe(
      '<CustomerQueryRq iterator="Continue" iteratorID="{ce85f3f2-8cca-4d06-a22c-6318d364d001}"><MaxReturned>100</MaxReturned></CustomerQueryRq>'
    );
  });

  it("rejects Continue without an iteratorID and non-positive MaxReturned", () => {
    expect(() =>
      buildIteratedQuery("CustomerQueryRq", "", {
        iterator: "Continue",
        maxReturned: 100
      })
    ).toThrow(/requires the iteratorID/);
    expect(() =>
      buildIteratedQuery("CustomerQueryRq", "", {
        iterator: "Start",
        maxReturned: 0
      })
    ).toThrow(/positive integer/);
  });
});

describe("classifyStatus (every branch of the mapping table)", () => {
  const cases: Array<
    [number, "Info" | "Warn" | "Error", QbxmlStatusKind, string | null]
  > = [
    [0, "Info", "ok", null],
    [1, "Info", "not-found", null],
    [3100, "Error", "warning", "NAME_EXISTS"],
    [3120, "Error", "warning", "OBJECT_NOT_FOUND"],
    [3140, "Error", "warning", "INVALID_REFERENCE"],
    [3170, "Error", "warning", "PERIOD_LOCKED"],
    [3171, "Error", "warning", "PERIOD_LOCKED"],
    [3175, "Error", "retryable", "QB_BUSY"],
    [3176, "Error", "retryable", "QB_BUSY"],
    [3180, "Error", "retryable", "QB_BUSY"],
    [3200, "Error", "retryable", "STALE_EDIT_SEQUENCE"],
    // Warn-severity statuses (e.g. 530 unsupported-version warning)
    [530, "Warn", "warning", "QB_WARNING"],
    // Unmapped Info-severity nonzero codes surface as warnings too
    [9999, "Info", "warning", "QB_WARNING"],
    // Everything else at Error severity is fatal with a greppable code
    [3260, "Error", "fatal", "QB_ERROR_3260"],
    [3261, "Error", "fatal", "QB_ERROR_3261"]
  ];

  it.each(
    cases
  )("maps %d/%s to kind=%s errorCode=%s", (code, severity, kind, errorCode) => {
    expect(classifyStatus(code, severity)).toEqual({ kind, errorCode });
  });

  it("severity does not override the explicit code map", () => {
    // A 3100 always classifies as NAME_EXISTS regardless of severity
    expect(classifyStatus(3100, "Warn")).toEqual({
      kind: "warning",
      errorCode: "NAME_EXISTS"
    });
  });
});

describe("QbxmlValidationError", () => {
  it("carries the core posting failure envelope and a greppable message", () => {
    const error = new QbxmlValidationError({
      errorCode: "NAME_TOO_LONG",
      message: "too long",
      warning: true,
      metadata: { maxLength: 41 }
    });

    expect(error.name).toBe("QbxmlValidationError");
    expect(error.message).toBe("NAME_TOO_LONG: too long");
    expect(isJournalEntrySyncFailure(error.failure)).toBe(true);
  });
});
