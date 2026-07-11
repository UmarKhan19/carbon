/**
 * qbXML message-set envelope building for QuickBooks Desktop (Enterprise
 * 24.0, qbXML spec ≤ 16.0) over the Web Connector transport.
 *
 * XML strategy: ALL request XML in this provider is built with template
 * literals, not fast-xml-parser's XMLBuilder — qbXML validates strict
 * element order per the OSR, and hand-ordered templates keep that order
 * explicit and the golden-snapshot tests exact. Parsing responses uses
 * XMLParser (see ./parse.ts).
 *
 * Protocol facts (research §QuickBooks Desktop Integration Surface):
 * - `requestID` is echo-correlation only and capped at 50 characters; the
 *   QBWC handler uses the sync-operation id as the requestID.
 * - TRUE write dedup across dropped connections is qbXML error recovery:
 *   stamp `newMessageSetID` on every writing message set, persist it until
 *   the response is processed, and after a disruption ask with
 *   `oldMessageSetID` — QuickBooks stores the last message-set id and its
 *   response, so we learn whether the writes landed instead of
 *   double-posting.
 * - `onError="continueOnError"` so one failed request does not abort the
 *   rest of the batch (there is no rollback support anyway).
 */

/** The SDK caps requestID at 50 characters. */
export const QBXML_MAX_REQUEST_ID_LENGTH = 50;

/** Escape user/text content for XML element text and attribute values. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Assert a caller-supplied requestID (the sync-operation id) fits the
 * SDK's 50-character cap. Violations are programmer errors — Carbon
 * operation ids are short — so this throws a plain Error, not a
 * QbxmlValidationError.
 */
export function assertRequestId(requestID: string): string {
  if (!requestID) {
    throw new Error("qbXML requestID must be a non-empty string");
  }
  if (requestID.length > QBXML_MAX_REQUEST_ID_LENGTH) {
    throw new Error(
      `qbXML requestID "${requestID}" is ${requestID.length} characters; the SDK caps requestID at ${QBXML_MAX_REQUEST_ID_LENGTH}`
    );
  }
  return requestID;
}

/**
 * Wrap a request body in its `<*Rq requestID="...">` element. Every D4
 * entity builder goes through this so the requestID cap is enforced in
 * one place.
 */
export function buildRequestElement(
  rqName: string,
  requestID: string,
  innerXml: string,
  attributes?: Record<string, string>
): string {
  assertRequestId(requestID);
  const attrs = [`requestID="${xmlEscape(requestID)}"`];
  for (const [name, value] of Object.entries(attributes ?? {})) {
    attrs.push(`${name}="${xmlEscape(value)}"`);
  }
  return `<${rqName} ${attrs.join(" ")}>${innerXml}</${rqName}>`;
}

export interface BuildMessageSetArgs {
  /**
   * qbXML version from the QBWC session handshake (sendRequestXML's
   * qbXMLMajorVers/qbXMLMinorVers), e.g. "16.0". Never hardcode outside
   * test defaults.
   */
  version: string;
  /**
   * Error-recovery id stamped on a WRITING message set (persist on the
   * session until the response is processed).
   */
  newMessageSetID?: string;
  /**
   * Recovery query: ask QuickBooks for the stored response of a previous
   * message set (statusCode 9002 on the message set = no stored response,
   * i.e. the writes never landed). Mutually exclusive with
   * newMessageSetID.
   */
  oldMessageSetID?: string;
  /**
   * Pre-built request elements (from the D4 entity builders), each already
   * carrying its own requestID attribute. May be empty for an
   * oldMessageSetID-only recovery probe; normal message sets should carry
   * at least one request.
   */
  requests: string[];
}

/**
 * Build a complete qbXML request document:
 *
 * `<?xml version="1.0" encoding="utf-8"?>`
 * `<?qbxml version="{version}"?>`
 * `<QBXML><QBXMLMsgsRq onError="continueOnError" ...>{requests}</QBXMLMsgsRq></QBXML>`
 */
export function buildMessageSet(args: BuildMessageSetArgs): string {
  if (!/^\d+\.\d+$/.test(args.version)) {
    throw new Error(
      `Invalid qbXML version "${args.version}" — expected "<major>.<minor>" from the session handshake`
    );
  }
  if (args.newMessageSetID && args.oldMessageSetID) {
    throw new Error(
      "newMessageSetID and oldMessageSetID are mutually exclusive: a new id stamps a fresh writing message set, an old id asks QuickBooks for a stored response"
    );
  }

  const attributes = ['onError="continueOnError"'];
  if (args.newMessageSetID) {
    attributes.push(`newMessageSetID="${xmlEscape(args.newMessageSetID)}"`);
  }
  if (args.oldMessageSetID) {
    attributes.push(`oldMessageSetID="${xmlEscape(args.oldMessageSetID)}"`);
  }

  return `<?xml version="1.0" encoding="utf-8"?>\n<?qbxml version="${args.version}"?>\n<QBXML><QBXMLMsgsRq ${attributes.join(" ")}>${args.requests.join("")}</QBXMLMsgsRq></QBXML>`;
}

export interface BuildIteratedQueryOptions {
  iterator: "Start" | "Continue";
  /** Required when iterator = "Continue" (echoed from readIterator). */
  iteratorID?: string;
  /** Page size — QuickBooks returns at most this many *Ret per response. */
  maxReturned: number;
  /** Optional correlation id (same 50-char cap as every request). */
  requestID?: string;
}

/**
 * Wrap a query request in the iterator pattern for large result sets:
 * `iterator="Start"` + MaxReturned opens the iterator, then
 * `iterator="Continue"` + iteratorID pages until
 * iteratorRemainingCount = 0 (see readIterator in ./parse.ts).
 * `innerXml` carries the query filters; MaxReturned is emitted first, per
 * the OSR element order.
 */
export function buildIteratedQuery(
  rqName: string,
  innerXml: string,
  options: BuildIteratedQueryOptions
): string {
  if (options.iterator === "Continue" && !options.iteratorID) {
    throw new Error(
      `${rqName} iterator="Continue" requires the iteratorID returned by the previous response`
    );
  }
  if (!Number.isInteger(options.maxReturned) || options.maxReturned <= 0) {
    throw new Error(
      `${rqName} maxReturned must be a positive integer, got ${options.maxReturned}`
    );
  }

  const attributes: string[] = [];
  if (options.requestID !== undefined) {
    attributes.push(
      `requestID="${xmlEscape(assertRequestId(options.requestID))}"`
    );
  }
  attributes.push(`iterator="${options.iterator}"`);
  if (options.iteratorID) {
    attributes.push(`iteratorID="${xmlEscape(options.iteratorID)}"`);
  }

  return `<${rqName} ${attributes.join(" ")}><MaxReturned>${options.maxReturned}</MaxReturned>${innerXml}</${rqName}>`;
}
