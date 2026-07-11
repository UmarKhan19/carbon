import { XMLParser } from "fast-xml-parser";

/**
 * qbXML response parsing (QuickBooks Desktop via the Web Connector).
 *
 * parseMessageSetResponse turns a `<QBXMLMsgsRs>` document into an ordered
 * array of per-request results — one entry per `*Rs` child, in document
 * order (QuickBooks answers in request order, and a batch interleaves
 * response types, so the parse uses fast-xml-parser's `preserveOrder`
 * representation and flattens it; a keyed parse would lose cross-type
 * ordering). The specified options still apply: `ignoreAttributes: false`,
 * `attributeNamePrefix: "@_"`, and `*Rs` children are always arrays
 * (inherent to preserveOrder). `parseTagValue`/`parseAttributeValue` are
 * off so every leaf stays a string — EditSequence/ListID/amounts must not
 * be coerced to numbers; parse.ts converts statusCode explicitly.
 *
 * Encoding: QuickBooks US editions respond in windows-1252 when the
 * company file contains non-ASCII text. When the XML prolog declares
 * windows-1252 (or an alias), a Buffer input is re-decoded byte-per-char
 * as latin1 and the 0x80–0x9F range is mapped through the cp1252 table
 * (plain latin1 would turn a curly quote 0x92 into the C1 control U+0092);
 * a string input that upstream already decoded as latin1 gets the same
 * 0x80–0x9F remap. Anything else is treated as UTF-8.
 */

export interface QbxmlResponse {
  /** Echo of the request's requestID (the sync-operation id), if present. */
  requestID: string | null;
  /** Request type without the Rq/Rs suffix, e.g. "CustomerAdd". */
  rqType: string;
  statusCode: number;
  statusSeverity: "Info" | "Warn" | "Error";
  statusMessage: string;
  /**
   * All attributes of the `*Rs` element with the "@_" prefix stripped
   * (requestID, statusCode, iteratorID, iteratorRemainingCount, ...).
   */
  attributes: Record<string, string>;
  /**
   * The parsed `*Ret` subtree: null when the response carries none (errors,
   * empty queries), a plain object for one Ret, an array for a multi-Ret
   * query response. Every leaf value is a string.
   */
  payload: unknown;
}

export interface QbxmlMessageSetStatus {
  /** Message-set-level statusCode (e.g. 9002 = no stored response for an oldMessageSetID recovery probe), or null when absent. */
  statusCode: number | null;
  statusSeverity: "Info" | "Warn" | "Error" | null;
  statusMessage: string | null;
  /** All attributes of QBXMLMsgsRs with the "@_" prefix stripped. */
  attributes: Record<string, string>;
}

type OrderedNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true
});

/** cp1252 0x80–0x9F → Unicode (bytes latin1 maps to C1 controls). */
const CP1252_REMAP: ReadonlyMap<number, string> = new Map([
  [0x80, "€"],
  [0x82, "‚"],
  [0x83, "ƒ"],
  [0x84, "„"],
  [0x85, "…"],
  [0x86, "†"],
  [0x87, "‡"],
  [0x88, "ˆ"],
  [0x89, "‰"],
  [0x8a, "Š"],
  [0x8b, "‹"],
  [0x8c, "Œ"],
  [0x8e, "Ž"],
  [0x91, "‘"],
  [0x92, "’"],
  [0x93, "“"],
  [0x94, "”"],
  [0x95, "•"],
  [0x96, "–"],
  [0x97, "—"],
  [0x98, "˜"],
  [0x99, "™"],
  [0x9a, "š"],
  [0x9b, "›"],
  [0x9c, "œ"],
  [0x9e, "ž"],
  [0x9f, "Ÿ"]
]);

function remapCp1252ControlRange(value: string): string {
  return value.replace(
    /[\u0080-\u009F]/g,
    (char) => CP1252_REMAP.get(char.charCodeAt(0)) ?? char
  );
}

function declaresWindows1252(prolog: string): boolean {
  const match = /encoding\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(prolog);
  const declared = (match?.[1] ?? match?.[2] ?? "").toLowerCase();
  return (
    declared === "windows-1252" ||
    declared === "cp1252" ||
    declared === "x-cp1252" ||
    declared === "win-1252"
  );
}

/**
 * Decode raw qbXML response bytes/text to a JS string, honoring a
 * windows-1252 prolog declaration (see module header). Exported for the
 * QBWC SOAP layer (D7) and tests.
 */
export function decodeQbxml(input: string | Buffer): string {
  if (typeof input === "string") {
    return declaresWindows1252(input.slice(0, 256))
      ? remapCp1252ControlRange(input)
      : input;
  }

  const prolog = input.subarray(0, 256).toString("latin1");
  if (declaresWindows1252(prolog)) {
    return remapCp1252ControlRange(input.toString("latin1"));
  }
  return input.toString("utf8");
}

/** The single non-":@" key of a preserveOrder node (its tag name). */
function nodeTag(node: OrderedNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ":@") return key;
  }
  return "";
}

function nodeChildren(node: OrderedNode): OrderedNode[] {
  const children = node[nodeTag(node)];
  return Array.isArray(children) ? (children as OrderedNode[]) : [];
}

/** Node attributes with the "@_" prefix stripped, values as strings. */
function nodeAttributes(node: OrderedNode): Record<string, string> {
  const raw = node[":@"];
  if (typeof raw !== "object" || raw === null) return {};

  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = key.startsWith("@_") ? key.slice(2) : key;
    attributes[name] = String(value);
  }
  return attributes;
}

/**
 * Convert a preserveOrder subtree to the plain-object shape a keyed parse
 * would produce: text-only elements become strings, repeated child tags
 * become arrays, attributes keep the "@_" prefix.
 */
function orderedToPlain(node: OrderedNode): unknown {
  const attributeEntries = Object.entries(nodeAttributes(node)).map(
    ([name, value]) => [`@_${name}`, value] as const
  );

  let text = "";
  const elementChildren: Array<[string, unknown]> = [];
  for (const child of nodeChildren(node)) {
    if ("#text" in child) {
      text += String(child["#text"]);
      continue;
    }
    elementChildren.push([nodeTag(child), orderedToPlain(child)]);
  }

  if (elementChildren.length === 0 && attributeEntries.length === 0) {
    return text;
  }

  const value: Record<string, unknown> = {};
  for (const [key, attributeValue] of attributeEntries) {
    value[key] = attributeValue;
  }
  for (const [childTag, childValue] of elementChildren) {
    const existing = value[childTag];
    if (existing === undefined) {
      value[childTag] = childValue;
    } else if (Array.isArray(existing)) {
      existing.push(childValue);
    } else {
      value[childTag] = [existing, childValue];
    }
  }
  if (text) {
    value["#text"] = text;
  }
  return value;
}

function normalizeSeverity(
  raw: string | undefined,
  statusCode: number
): "Info" | "Warn" | "Error" {
  if (raw === "Info" || raw === "Warn" || raw === "Error") return raw;
  return statusCode === 0 ? "Info" : "Error";
}

function getMessageSetNode(xml: string | Buffer): OrderedNode {
  const documentNodes = parser.parse(decodeQbxml(xml)) as OrderedNode[];
  const qbxml = documentNodes.find((node) => nodeTag(node) === "QBXML");
  if (!qbxml) {
    throw new Error("Malformed qbXML response: missing <QBXML> root element");
  }

  const messageSet = nodeChildren(qbxml).find(
    (node) => nodeTag(node) === "QBXMLMsgsRs"
  );
  if (!messageSet) {
    throw new Error(
      "Malformed qbXML response: missing <QBXMLMsgsRs> message set"
    );
  }
  return messageSet;
}

/**
 * Parse a qbXML response document into ordered per-request results (see
 * module header). statusCode defaults to 0 and severity to Info only when
 * the attributes are absent — QuickBooks always sends them in practice.
 */
export function parseMessageSetResponse(xml: string | Buffer): QbxmlResponse[] {
  const messageSet = getMessageSetNode(xml);

  const responses: QbxmlResponse[] = [];
  for (const child of nodeChildren(messageSet)) {
    const tag = nodeTag(child);
    if (!tag.endsWith("Rs")) continue;

    const attributes = nodeAttributes(child);
    const statusCode =
      attributes.statusCode !== undefined ? Number(attributes.statusCode) : 0;

    const rets = nodeChildren(child)
      .filter((node) => nodeTag(node).endsWith("Ret"))
      .map((node) => orderedToPlain(node));

    responses.push({
      requestID: attributes.requestID ?? null,
      rqType: tag.slice(0, -2),
      statusCode,
      statusSeverity: normalizeSeverity(attributes.statusSeverity, statusCode),
      statusMessage: attributes.statusMessage ?? "",
      attributes,
      payload: rets.length === 0 ? null : rets.length === 1 ? rets[0] : rets
    });
  }

  return responses;
}

/**
 * Message-set-level status attributes of QBXMLMsgsRs. The crash-recovery
 * branch (D8) checks statusCode 9002 here: an oldMessageSetID probe with
 * no stored response means the interrupted batch never reached QuickBooks.
 */
export function parseMessageSetStatus(
  xml: string | Buffer
): QbxmlMessageSetStatus {
  const attributes = nodeAttributes(getMessageSetNode(xml));
  const statusCode =
    attributes.statusCode !== undefined ? Number(attributes.statusCode) : null;

  return {
    statusCode,
    statusSeverity:
      statusCode === null
        ? null
        : normalizeSeverity(attributes.statusSeverity, statusCode),
    statusMessage: attributes.statusMessage ?? null,
    attributes
  };
}

/**
 * Read the iterator attributes off a query response entry. Loop while
 * remainingCount > 0, echoing iteratorID via buildIteratedQuery
 * (iterator="Continue").
 */
export function readIterator(rs: Pick<QbxmlResponse, "attributes">): {
  iteratorID: string | null;
  remainingCount: number;
} {
  const raw = rs.attributes.iteratorRemainingCount;
  const remainingCount = raw !== undefined ? Number(raw) : 0;

  return {
    iteratorID: rs.attributes.iteratorID ?? null,
    remainingCount: Number.isFinite(remainingCount) ? remainingCount : 0
  };
}
