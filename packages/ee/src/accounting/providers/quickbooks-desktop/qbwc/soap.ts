import { XMLParser } from "fast-xml-parser";
import { xmlEscape } from "../qbxml/envelope";

/**
 * SOAP envelope layer for the QuickBooks Web Connector endpoint.
 *
 * QBWC speaks SOAP 1.1 against a fixed WSDL whose namespace MUST be
 * `http://developer.intuit.com/` — the operation names, their parameter
 * element names (strUserName, ticket, strHCPResponse, qbXMLMajorVers, ...)
 * and the response shapes (`<{op}Response><{op}Result>`) are all
 * load-bearing (research §QBWC protocol contract). This module only
 * translates between SOAP XML and plain
 * `{ operation, params }` / result values; every protocol decision lives
 * in ./handler.ts.
 *
 * Parsing keeps every parameter a string (`parseTagValue: false`) — the
 * `response` parameter of receiveResponseXML carries an entire qbXML
 * document as escaped text, and version numbers like "16" must not become
 * JS numbers. Namespace prefixes are stripped (`removeNSPrefix`) so
 * `<soap:Body>` and prefixed operation elements resolve the same way.
 */

export const QBWC_SOAP_NAMESPACE = "http://developer.intuit.com/";

/** The eight QBWC callbacks, in protocol order. */
export const QBWC_SOAP_OPERATIONS = [
  "serverVersion",
  "clientVersion",
  "authenticate",
  "sendRequestXML",
  "receiveResponseXML",
  "connectionError",
  "getLastError",
  "closeConnection"
] as const;

export type QbwcSoapOperation = (typeof QBWC_SOAP_OPERATIONS)[number];

export interface QbwcSoapRequest {
  operation: QbwcSoapOperation;
  /**
   * Child elements of the operation element by name. Missing, empty and
   * self-closing elements all read as "".
   */
  params: Record<string, string>;
}

/**
 * A QBWC result value: a plain string (`serverVersionResult`, ...), an int
 * (`receiveResponseXMLResult` percent-done) or a string array
 * (`authenticateResult`, rendered as `<string>` children).
 */
export type QbwcSoapResult = string | number | string[];

/**
 * Thrown by parseQbwcSoapRequest on a malformed envelope or an unknown
 * operation; the handler answers it with buildQbwcSoapFault.
 */
export class QbwcSoapFaultError extends Error {
  readonly faultCode: "Client" | "Server";

  constructor(faultCode: "Client" | "Server", message: string) {
    super(message);
    this.name = "QbwcSoapFaultError";
    this.faultCode = faultCode;
  }
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  ignoreDeclaration: true
});

function isQbwcSoapOperation(name: string): name is QbwcSoapOperation {
  return (QBWC_SOAP_OPERATIONS as readonly string[]).includes(name);
}

/**
 * Parse an incoming QBWC SOAP envelope to `{ operation, params }`. Throws
 * QbwcSoapFaultError (faultCode "Client") for anything that is not a
 * well-formed envelope around one of the eight known operations.
 */
export function parseQbwcSoapRequest(xml: string): QbwcSoapRequest {
  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new QbwcSoapFaultError(
      "Client",
      `Malformed SOAP envelope: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const envelope =
    document && typeof document === "object"
      ? (document as Record<string, unknown>).Envelope
      : undefined;
  const body =
    envelope && typeof envelope === "object"
      ? (envelope as Record<string, unknown>).Body
      : undefined;

  if (!body || typeof body !== "object") {
    throw new QbwcSoapFaultError(
      "Client",
      "Malformed SOAP envelope: missing <soap:Body>"
    );
  }

  const operationName = Object.keys(body).find((key) => key !== "#text");
  if (!operationName) {
    throw new QbwcSoapFaultError(
      "Client",
      "Malformed SOAP envelope: empty <soap:Body>"
    );
  }
  if (!isQbwcSoapOperation(operationName)) {
    throw new QbwcSoapFaultError(
      "Client",
      `Unknown QBWC operation: ${operationName}`
    );
  }

  const element = (body as Record<string, unknown>)[operationName];
  const params: Record<string, string> = {};
  if (element && typeof element === "object") {
    for (const [name, value] of Object.entries(element)) {
      if (name === "#text") continue;
      params[name] = typeof value === "string" ? value : "";
    }
  }

  return { operation: operationName, params };
}

/**
 * Build the SOAP response envelope for an operation result. String arrays
 * render as `<string>` children (the authenticate contract); numbers render
 * as bare int text; strings are escaped text content.
 */
export function buildQbwcSoapResponse(
  operation: QbwcSoapOperation,
  result: QbwcSoapResult
): string {
  const resultXml = Array.isArray(result)
    ? result.map((value) => `<string>${xmlEscape(value)}</string>`).join("")
    : typeof result === "number"
      ? String(result)
      : xmlEscape(result);

  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    `<soap:Body><${operation}Response xmlns="${QBWC_SOAP_NAMESPACE}">` +
    `<${operation}Result>${resultXml}</${operation}Result>` +
    `</${operation}Response></soap:Body></soap:Envelope>`
  );
}

/**
 * Build a SOAP Fault envelope — the answer to unknown operations, malformed
 * envelopes ("Client") and unexpected handler errors ("Server"). QBWC
 * surfaces the faultstring in its log.
 */
export function buildQbwcSoapFault(
  faultCode: "Client" | "Server",
  faultString: string
): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    "<soap:Body><soap:Fault>" +
    `<faultcode>soap:${faultCode}</faultcode>` +
    `<faultstring>${xmlEscape(faultString)}</faultstring>` +
    "</soap:Fault></soap:Body></soap:Envelope>"
  );
}
