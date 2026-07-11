import { buildRequestElement, xmlEscape } from "../envelope";
import { QbxmlValidationError } from "../errors";

/**
 * Shared field helpers for the qbXML entity builders (D4), mirroring the
 * quickbooks-online provider's entities/shared.ts convention.
 *
 * QuickBooks Desktop field constraints (research §QuickBooks Desktop
 * Integration Surface) enforced here:
 * - customer/vendor names ≤ 41 chars PER hierarchy level (":"-joined),
 *   item/account names ≤ 31 per level, address lines ≤ 41 — violations
 *   throw QbxmlValidationError NAME_TOO_LONG (Warning; no silent
 *   truncation).
 * - RefNumber ≤ 11 chars and NOT unique-enforced by the SDK: fitRefNumber
 *   returns undefined when the readable id does not fit, and the readable
 *   id then travels ONLY in Memo. Every transaction stamps
 *   `Carbon <readable id> <entity id>` in Memo (buildCarbonMemo) — the
 *   belt-and-braces dedup alongside query-before-insert and
 *   newMessageSetID recovery.
 * - Every `*Ref` prefers ListID (opaque, stable — the account/entity
 *   mapping's externalId) over FullName (exact-punctuation colon-joined
 *   name path, allowed only as a pre-resolution fallback).
 *
 * All user text is XML-escaped via xmlEscape. Every leaf value produced by
 * parse.ts is a string (parseTagValue is off), so the parseRet helpers
 * read string fields only.
 */

/** Customer/vendor (list-entity) name cap per hierarchy level. */
export const QBD_LIST_NAME_MAX_LENGTH = 41;

/** Item/account name cap per hierarchy level. */
export const QBD_ITEM_NAME_MAX_LENGTH = 31;

/** Address line (Addr1–Addr5) cap. */
export const QBD_ADDRESS_LINE_MAX_LENGTH = 41;

/** RefNumber cap on transactions (uniqueness is NOT enforced by the SDK). */
export const QBD_REF_NUMBER_MAX_LENGTH = 11;

/**
 * Reference to a QuickBooks object. ListID comes from the
 * externalIntegrationMapping (externalId); FullName is the
 * pre-resolution fallback only.
 */
export interface QbdRef {
  listId?: string | null;
  fullName?: string | null;
}

/** `{ line1: "1 Factory Way", ... }` → BillAddress/VendorAddress blocks. */
export interface QbdAddressInput {
  line1?: string | null;
  line2?: string | null;
  line3?: string | null;
  line4?: string | null;
  line5?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/** Parsed list-entity `*Ret` (customer/vendor/item). */
export interface QbdListRet {
  listId: string;
  editSequence: string | null;
  /** Colon-joined hierarchical name (falls back to Name when absent). */
  fullName: string | null;
  name: string | null;
  /** The raw parsed Ret subtree (string leaves). */
  fields: Record<string, unknown>;
}

/** Parsed transaction `*Ret` (invoice/bill/PO/journal entry). */
export interface QbdTxnRet {
  txnId: string;
  editSequence: string | null;
  refNumber: string | null;
  /** Header memo — carries the Carbon stamp for memo-scan dedupe. */
  memo: string | null;
  /** The raw parsed Ret subtree (string leaves). */
  fields: Record<string, unknown>;
}

/** `<Tag>escaped value</Tag>` — value is required. */
export function element(tag: string, value: string): string {
  return `<${tag}>${xmlEscape(value)}</${tag}>`;
}

/** element(), or "" when the value is null/undefined/empty. */
export function optionalElement(
  tag: string,
  value: string | null | undefined
): string {
  return value ? element(tag, value) : "";
}

/** Format a currency amount at 2dp (sign preserved). */
export function formatAmount(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/** Format a quantity with up to 5 decimal places, trailing zeros trimmed. */
export function formatQuantity(quantity: number): string {
  return String(Number(quantity.toFixed(5)));
}

/** Assert + normalize a date to qbXML's YYYY-MM-DD. */
export function formatDate(date: string): string {
  const day = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Invalid qbXML date "${date}" — expected YYYY-MM-DD`);
  }
  return day;
}

/**
 * A readable id that fits the 11-char RefNumber cap, or undefined when it
 * does not — the readable id then goes ONLY in Memo (never truncated).
 */
export function fitRefNumber(readableId: string): string | undefined {
  if (!readableId || readableId.length > QBD_REF_NUMBER_MAX_LENGTH) {
    return undefined;
  }
  return readableId;
}

/** The Memo stamp every pushed transaction carries. */
export function buildCarbonMemo(readableId: string, entityId: string): string {
  return `Carbon ${readableId} ${entityId}`;
}

function nameTooLong(args: {
  label: string;
  value: string;
  maxLength: number;
  detail: string;
}): QbxmlValidationError {
  return new QbxmlValidationError({
    errorCode: "NAME_TOO_LONG",
    message: `${args.detail} Shorten it in Carbon, then retry.`,
    warning: true,
    metadata: {
      label: args.label,
      value: args.value,
      maxLength: args.maxLength
    }
  });
}

/**
 * Enforce QuickBooks' per-hierarchy-level name cap (levels are
 * ":"-separated). Throws QbxmlValidationError NAME_TOO_LONG.
 */
export function assertQbdName(
  name: string,
  maxLengthPerLevel: number,
  label: string
): string {
  if (!name) {
    throw new Error(`${label} must be a non-empty string`);
  }
  for (const level of name.split(":")) {
    if (level.length > maxLengthPerLevel) {
      throw nameTooLong({
        label,
        value: name,
        maxLength: maxLengthPerLevel,
        detail: `QuickBooks Desktop caps each ${label} level at ${maxLengthPerLevel} characters; "${level}" is ${level.length}.`
      });
    }
  }
  return name;
}

/**
 * BillAddress/VendorAddress/ShipAddress block. Address lines over 41
 * characters throw NAME_TOO_LONG (Warning). Returns "" when the address
 * is empty.
 */
export function buildAddressXml(
  tag: string,
  address: QbdAddressInput | null | undefined,
  label: string
): string {
  if (!address) return "";

  const lines = [
    address.line1,
    address.line2,
    address.line3,
    address.line4,
    address.line5
  ];

  const parts: string[] = [];
  lines.forEach((line, index) => {
    if (!line) return;
    if (line.length > QBD_ADDRESS_LINE_MAX_LENGTH) {
      throw nameTooLong({
        label: `${label} address line ${index + 1}`,
        value: line,
        maxLength: QBD_ADDRESS_LINE_MAX_LENGTH,
        detail: `QuickBooks Desktop caps address lines at ${QBD_ADDRESS_LINE_MAX_LENGTH} characters; ${label} address line ${index + 1} is ${line.length}.`
      });
    }
    parts.push(element(`Addr${index + 1}`, line));
  });

  parts.push(optionalElement("City", address.city));
  parts.push(optionalElement("State", address.state));
  parts.push(optionalElement("PostalCode", address.postalCode));
  parts.push(optionalElement("Country", address.country));

  const inner = parts.join("");
  return inner ? `<${tag}>${inner}</${tag}>` : "";
}

/** `<Tag><ListID>…</ListID></Tag>` (preferred) or FullName; "" when empty. */
export function buildRefXml(
  tag: string,
  ref: QbdRef | null | undefined
): string {
  if (!ref) return "";
  if (ref.listId) {
    return `<${tag}><ListID>${xmlEscape(ref.listId)}</ListID></${tag}>`;
  }
  if (ref.fullName) {
    return `<${tag}><FullName>${xmlEscape(ref.fullName)}</FullName></${tag}>`;
  }
  return "";
}

/**
 * Required customer/vendor/item reference. An empty ref is a sequencing
 * bug (dependency sync pushes the entity first), so this throws a plain
 * Error — not a user-fixable QbxmlValidationError.
 */
export function buildEntityRefXml(
  tag: string,
  ref: QbdRef | null | undefined,
  label: string
): string {
  const xml = buildRefXml(tag, ref);
  if (!xml) {
    throw new Error(
      `Cannot build ${tag}: the ${label} has no ListID or FullName — sync the ${label} to QuickBooks Desktop first`
    );
  }
  return xml;
}

/**
 * Required G/L account reference from the account mapping. An empty ref
 * throws the structured UNMAPPED_ACCOUNTS Warning (user-fixable on the
 * integration settings page).
 */
export function buildAccountRefXml(
  tag: string,
  ref: QbdRef | null | undefined,
  accountLabel: string
): string {
  const xml = buildRefXml(tag, ref);
  if (!xml) {
    throw new QbxmlValidationError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `No QuickBooks Desktop account is mapped for ${accountLabel}. Map the account on the integration settings page, then retry.`,
      warning: true,
      metadata: { tag, accountLabel }
    });
  }
  return xml;
}

/** First Ret object out of a parseMessageSetResponse payload, or null. */
function firstRet(payload: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(payload) ? payload[0] : payload;
  if (typeof candidate !== "object" || candidate === null) return null;
  return candidate as Record<string, unknown>;
}

function stringField(
  fields: Record<string, unknown>,
  key: string
): string | null {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Parse a list-entity Ret payload (accepts the single-object or array
 * payload shape; an array reads its first Ret — FullName queries return
 * at most one). Returns null when the payload carries no Ret (statusCode 1
 * query miss); throws when a Ret is present but has no ListID.
 */
export function parseListRet(
  payload: unknown,
  retLabel: string
): QbdListRet | null {
  const fields = firstRet(payload);
  if (!fields) return null;

  const listId = stringField(fields, "ListID");
  if (!listId) {
    throw new Error(`Malformed ${retLabel}: missing ListID`);
  }

  return {
    listId,
    editSequence: stringField(fields, "EditSequence"),
    fullName: stringField(fields, "FullName") ?? stringField(fields, "Name"),
    name: stringField(fields, "Name"),
    fields
  };
}

/**
 * Parse a transaction Ret payload (same null/throw contract as
 * parseListRet, keyed on TxnID).
 */
export function parseTxnRet(
  payload: unknown,
  retLabel: string
): QbdTxnRet | null {
  const fields = firstRet(payload);
  if (!fields) return null;

  const txnId = stringField(fields, "TxnID");
  if (!txnId) {
    throw new Error(`Malformed ${retLabel}: missing TxnID`);
  }

  return {
    txnId,
    editSequence: stringField(fields, "EditSequence"),
    refNumber: stringField(fields, "RefNumber"),
    memo: stringField(fields, "Memo"),
    fields
  };
}

/** Args for the query-before-insert transaction queries. */
export interface QbdTxnQueryArgs {
  requestID: string;
  /** Exact RefNumber match — the primary dedupe probe when the readable id fit. */
  refNumber?: string;
  /** TxnDateRangeFilter fallback when the RefNumber did not fit (≤ 11): the caller scans returned Memos for the Carbon stamp. */
  txnDateFrom?: string;
  txnDateTo?: string;
}

/**
 * `<*QueryRq>` by RefNumber (exact) or by TxnDateRangeFilter (memo-scan
 * fallback) — exactly one mode.
 */
export function buildTxnQueryRqXml(
  rqName: string,
  args: QbdTxnQueryArgs
): string {
  const byRefNumber = args.refNumber !== undefined;
  const byDateRange =
    args.txnDateFrom !== undefined || args.txnDateTo !== undefined;

  if (byRefNumber === byDateRange) {
    throw new Error(
      `${rqName} needs exactly one filter: refNumber, or a txnDate range for the memo-scan fallback`
    );
  }

  if (byRefNumber) {
    const refNumber = args.refNumber ?? "";
    if (
      refNumber.length === 0 ||
      refNumber.length > QBD_REF_NUMBER_MAX_LENGTH
    ) {
      throw new Error(
        `${rqName} refNumber "${refNumber}" must be 1–${QBD_REF_NUMBER_MAX_LENGTH} characters (use fitRefNumber)`
      );
    }
    return buildRequestElement(
      rqName,
      args.requestID,
      element("RefNumber", refNumber)
    );
  }

  const range = `<TxnDateRangeFilter>${
    args.txnDateFrom ? element("FromTxnDate", formatDate(args.txnDateFrom)) : ""
  }${
    args.txnDateTo ? element("ToTxnDate", formatDate(args.txnDateTo)) : ""
  }</TxnDateRangeFilter>`;

  return buildRequestElement(rqName, args.requestID, range);
}

/** `<*QueryRq>` by exact FullName (list entities' dedupe probe). */
export function buildListQueryRqXml(
  rqName: string,
  args: { requestID: string; fullName: string }
): string {
  if (!args.fullName) {
    throw new Error(`${rqName} fullName must be a non-empty string`);
  }
  return buildRequestElement(
    rqName,
    args.requestID,
    element("FullName", args.fullName)
  );
}
