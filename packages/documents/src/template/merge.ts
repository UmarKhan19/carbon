import type { JSONContent } from "@carbon/react";

/**
 * Merge fields — `{{token}}` placeholders that resolve to live document data at
 * render time. Inspired by Bindery's `{ expression }` content model, but kept
 * as inline string tokens so they compose inside rich text and key-value rows
 * the user already authors, with no separate value|expression object.
 */
export interface MergeField {
  /** Token text without braces, e.g. `invoice.number`. */
  token: string;
  label: string;
  group: string;
}

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Replace every `{{token}}` in a string with its variable value ("" if unknown). */
export function interpolateString(
  text: string,
  vars: Record<string, string>
): string {
  return text.replace(TOKEN_RE, (_match, token: string) => vars[token] ?? "");
}

/**
 * Deep-clone a tiptap document, replacing `{{token}}` inside every text node.
 * Pure — never mutates the input (block state stays as the user authored it).
 */
export function interpolateContent(
  content: JSONContent,
  vars: Record<string, string>
): JSONContent {
  const walk = (node: JSONContent): JSONContent => {
    const next: JSONContent = { ...node };
    if (typeof next.text === "string") {
      next.text = interpolateString(next.text, vars);
    }
    if (Array.isArray(next.content)) {
      next.content = next.content.map(walk);
    }
    return next;
  };
  return walk(content);
}

/** Wrap a token for insertion into authored content. */
export function mergeToken(token: string): string {
  return `{{${token}}}`;
}

const SALES_INVOICE_MERGE_FIELDS: MergeField[] = [
  { token: "invoice.number", label: "Invoice Number", group: "Invoice" },
  { token: "invoice.dateIssued", label: "Issue Date", group: "Invoice" },
  { token: "invoice.dateDue", label: "Due Date", group: "Invoice" },
  {
    token: "invoice.customerReference",
    label: "Customer Reference",
    group: "Invoice"
  },
  { token: "invoice.currency", label: "Currency", group: "Invoice" },
  { token: "customer.name", label: "Customer Name", group: "Customer" },
  { token: "customer.addressLine1", label: "Address", group: "Customer" },
  { token: "customer.city", label: "City", group: "Customer" },
  { token: "customer.country", label: "Country", group: "Customer" },
  { token: "company.name", label: "Company Name", group: "Company" },
  { token: "company.city", label: "Company City", group: "Company" },
  { token: "company.country", label: "Company Country", group: "Company" }
];

/** Catalog of insertable merge fields per document type (editor-facing). */
export const MERGE_FIELDS: Record<string, MergeField[]> = {
  salesInvoice: SALES_INVOICE_MERGE_FIELDS
};

export function getMergeFields(documentType: string): MergeField[] {
  return MERGE_FIELDS[documentType] ?? [];
}
