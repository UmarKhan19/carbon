import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildOptionLookup,
  type MatchableOption,
  matchCsvValue
} from "~/components/ImportCSVModal/enumMatch";

/**
 * Shared "autofill from extracted PDF" resolver.
 *
 * Replaces the two near-identical `handleExtractionComplete` handlers that lived
 * inside PurchaseInvoiceForm and SalesRFQForm. Given the confidence-filtered
 * extraction payload, it:
 *   1. matches the top-level entity (supplier / customer) by name,
 *   2. matches that entity's contacts + location against the extracted values,
 *   3. fills scalar fields (references, dates, currency, …) directly,
 *   4. returns anything it could NOT match as `unmatched[]` so the modal can let
 *      the user map-to-existing or create-and-select.
 *
 * Matching reuses the canonical CSV-import matcher (`enumMatch`) — normalized,
 * case-insensitive, alias-aware — instead of the old bespoke `ilike` + lowercase
 * comparisons.
 */

export type AutofillDocumentType = "purchaseInvoice" | "salesRfq";

export type EntityKind =
  | "supplier"
  | "customer"
  | "supplierContact"
  | "customerContact"
  | "supplierLocation"
  | "customerLocation";

/** An entity referenced by the PDF that did not auto-match an existing record. */
export type UnmatchedEntity = {
  /** Form field this resolves once mapped/created, e.g. "invoiceSupplierContactId". */
  field: string;
  kind: EntityKind;
  /** Resolved parent id (supplier/customer) for contact/location scoping. */
  parentId?: string;
  /** Extracted display text shown on the left of the mapping row. */
  label: string;
  /** Existing records the user can map to. */
  options: MatchableOption[];
  /** Extracted fields used to prefill a create form. */
  prefill: Record<string, unknown>;
};

export type AutofillResolution = {
  documentType: AutofillDocumentType;
  /** Form fields to set directly (auto-matched ids + scalar values). */
  values: Record<string, string | number | null | undefined>;
  lineItems: unknown[];
  /** Invoice tax, passed through to the form's hidden input (PI only). */
  taxAmount?: number;
  storagePath?: string;
  /** Entities needing user resolution; empty => modal can auto-close. */
  unmatched: UnmatchedEntity[];
  /** Non-blocking advisories surfaced to the reviewer (e.g. duplicate invoice). */
  warnings?: string[];
};

/** Result of resolving a parent's children (contacts + location) against the PDF. */
export type ChildResolution = {
  /** field -> matched id, to merge into the form values. */
  values: Record<string, string>;
  /** child entities that still need user resolution. */
  unmatched: UnmatchedEntity[];
};

type Client = SupabaseClient<Database>;
type Extracted = Record<string, any>;

const str = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
};

/** Match a person by full name or email using the canonical matcher. */
function matchPerson(
  contacts: Array<{
    id: string;
    contact: { fullName?: string | null; email?: string | null } | null;
  }>,
  name: string | undefined,
  email: string | undefined
): { matchedId?: string; options: MatchableOption[] } {
  const options: MatchableOption[] = contacts.map((c) => ({
    label: c.contact?.email ?? c.contact?.fullName ?? c.id,
    value: c.id,
    aliases: [c.contact?.fullName, c.contact?.email].filter(
      (a): a is string => !!a
    )
  }));
  const lookup = buildOptionLookup(options);
  const matchedId =
    (email && matchCsvValue(lookup, email)) ||
    (name && matchCsvValue(lookup, name)) ||
    undefined;
  return { matchedId, options };
}

/**
 * Match a location by its first address line. Locations have no clean single
 * label, so we match on addressLine1 (normalized) and keep the substring
 * fallback the original handler relied on for partial PDF addresses.
 */
function matchLocation(
  locations: Array<{
    id: string;
    address: { addressLine1?: string | null } | null;
  }>,
  addressLine1: string | undefined
): { matchedId?: string; options: MatchableOption[] } {
  const options: MatchableOption[] = locations.map((l) => ({
    label: l.address?.addressLine1 ?? l.id,
    value: l.id
  }));
  if (!addressLine1) return { matchedId: undefined, options };
  const needle = addressLine1.toLowerCase();
  const matched = locations.find((l) => {
    const hay = l.address?.addressLine1?.trim().toLowerCase();
    return !!hay && (needle.includes(hay) || hay.includes(needle));
  });
  return { matchedId: matched?.id, options };
}

function splitName(full: string | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || undefined
  };
}

async function resolveByName(
  client: Client,
  table: "supplier" | "customer",
  name: string,
  select: string
): Promise<{ id: string; row: any } | null> {
  const { data } = await client
    .from(table)
    .select(select)
    .ilike("name", `%${name}%`)
    .limit(1);
  const row = data?.[0] as any;
  return row?.id ? { id: row.id, row } : null;
}

async function resolvePurchaseInvoice(
  client: Client,
  data: Extracted
): Promise<AutofillResolution> {
  const values: AutofillResolution["values"] = {};
  const unmatched: UnmatchedEntity[] = [];
  const warnings: string[] = [];

  const supplierName = str(data.supplierName);
  const matchedSupplier = supplierName
    ? await resolveByName(
        client,
        "supplier",
        supplierName,
        "id, name, currencyCode"
      )
    : null;

  // Scalars fill directly regardless of supplier match.
  values.supplierReference = str(data.invoiceNumber);
  values.dateIssued = str(data.invoiceDate);
  values.dateDue = str(data.dueDate);
  values.supplierShippingCost =
    typeof data.shippingCost === "number" ? data.shippingCost : undefined;
  values.currencyCode =
    str(data.currencyCode) ?? matchedSupplier?.row.currencyCode ?? undefined;

  // Payment terms — simple name match.
  const paymentTerms = str(data.paymentTerms);
  if (paymentTerms) {
    const { data: terms } = await client
      .from("paymentTerm")
      .select("id, name")
      .ilike("name", `%${paymentTerms}%`)
      .limit(1);
    if (terms?.[0]?.id) values.paymentTermId = terms[0].id;
  }

  if (matchedSupplier) {
    values.supplierId = matchedSupplier.id;
    values.invoiceSupplierId = matchedSupplier.id;

    const children = await resolveSupplierChildren(
      client,
      data,
      matchedSupplier.id
    );
    Object.assign(values, children.values);
    unmatched.push(...children.unmatched);

    // Duplicate-invoice guard: same supplier + supplier invoice number on file.
    if (values.supplierReference) {
      const { data: dups } = await client
        .from("purchaseInvoices")
        .select("invoiceId")
        .eq("supplierId", matchedSupplier.id)
        .eq("supplierReference", values.supplierReference as string)
        .limit(1);
      if (dups && dups.length > 0)
        warnings.push(
          `A purchase invoice "${dups[0].invoiceId}" with reference "${values.supplierReference}" already exists for this supplier — this may be a duplicate.`
        );
    }
  } else if (supplierName) {
    // Supplier itself is unmatched — offer create/map.
    const { data: suppliers } = await client
      .from("supplier")
      .select("id, name")
      .order("name")
      .limit(100);
    unmatched.unshift({
      field: "supplierId",
      kind: "supplier",
      label: supplierName,
      options: (suppliers ?? []).map((s) => ({ label: s.name, value: s.id })),
      prefill: { name: supplierName, currencyCode: values.currencyCode }
    });
  }

  return {
    documentType: "purchaseInvoice",
    values,
    lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
    taxAmount: typeof data.taxAmount === "number" ? data.taxAmount : undefined,
    storagePath: str(data._storagePath),
    unmatched,
    warnings
  };
}

async function resolveSalesRfq(
  client: Client,
  data: Extracted
): Promise<AutofillResolution> {
  const values: AutofillResolution["values"] = {};
  const unmatched: UnmatchedEntity[] = [];

  const customerName = str(data.customerName);
  const matchedCustomer = customerName
    ? await resolveByName(client, "customer", customerName, "id, name")
    : null;

  values.customerReference = str(data.rfqNumber);
  values.rfqDate = str(data.rfqDate);
  values.expirationDate = str(data.dueDate);

  if (matchedCustomer) {
    values.customerId = matchedCustomer.id;
    const children = await resolveCustomerChildren(
      client,
      data,
      matchedCustomer.id
    );
    Object.assign(values, children.values);
    unmatched.push(...children.unmatched);
  } else if (customerName) {
    const { data: customers } = await client
      .from("customer")
      .select("id, name")
      .order("name")
      .limit(100);
    unmatched.unshift({
      field: "customerId",
      kind: "customer",
      label: customerName,
      options: (customers ?? []).map((c) => ({ label: c.name, value: c.id })),
      prefill: { name: customerName }
    });
  }

  return {
    documentType: "salesRfq",
    values,
    lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
    storagePath: str(data._storagePath),
    unmatched
  };
}

function pushContact(
  unmatched: UnmatchedEntity[],
  values: AutofillResolution["values"],
  field: string,
  kind: EntityKind,
  parentId: string,
  contacts: any[],
  name: string | undefined,
  email: string | undefined,
  phone: string | undefined
) {
  if (!name && !email) return;
  const { matchedId, options } = matchPerson(contacts, name, email);
  if (matchedId) {
    values[field] = matchedId;
    return;
  }
  unmatched.push({
    field,
    kind,
    parentId,
    label: name ?? email!,
    options,
    prefill: { ...splitName(name), email, mobilePhone: phone }
  });
}

function addressPrefill(data: Extracted, prefix: "supplier" | "customer") {
  const p = (k: string) => str(data[`${prefix}${k}`]);
  return {
    addressLine1: p("AddressLine1"),
    addressLine2: p("AddressLine2"),
    city: p("City"),
    stateProvince: p("StateProvince"),
    postalCode: p("PostalCode"),
    countryCode: p("Country")
  };
}

async function resolveSupplierChildren(
  client: Client,
  data: Extracted,
  supplierId: string
): Promise<ChildResolution> {
  const values: Record<string, string> = {};
  const unmatched: UnmatchedEntity[] = [];
  const [contactResult, locationResult] = await Promise.all([
    client
      .from("supplierContact")
      .select("id, contact(id, fullName, email)")
      .eq("supplierId", supplierId),
    client
      .from("supplierLocation")
      .select("id, address(id, addressLine1)")
      .eq("supplierId", supplierId)
  ]);
  const contacts = (contactResult.data ?? []) as any[];
  const locations = (locationResult.data ?? []) as any[];

  const contactName = str(data.supplierContactName);
  const contactEmail = str(data.supplierContactEmail);
  if (contactName || contactEmail) {
    const { matchedId, options } = matchPerson(
      contacts,
      contactName,
      contactEmail
    );
    if (matchedId) values.invoiceSupplierContactId = matchedId;
    else
      unmatched.push({
        field: "invoiceSupplierContactId",
        kind: "supplierContact",
        parentId: supplierId,
        label: contactName ?? contactEmail!,
        options,
        prefill: {
          ...splitName(contactName),
          email: contactEmail,
          mobilePhone: str(data.supplierContactPhone)
        }
      });
  }

  const addressLine1 = str(data.supplierAddressLine1);
  if (addressLine1 || str(data.supplierCity)) {
    const { matchedId, options } = matchLocation(locations, addressLine1);
    if (matchedId) values.invoiceSupplierLocationId = matchedId;
    else
      unmatched.push({
        field: "invoiceSupplierLocationId",
        kind: "supplierLocation",
        parentId: supplierId,
        label: addressLine1 ?? str(data.supplierCity)!,
        options,
        prefill: addressPrefill(data, "supplier")
      });
  }
  return { values, unmatched };
}

async function resolveCustomerChildren(
  client: Client,
  data: Extracted,
  customerId: string
): Promise<ChildResolution> {
  const values: Record<string, string> = {};
  const unmatched: UnmatchedEntity[] = [];
  const [contactResult, locationResult] = await Promise.all([
    client
      .from("customerContact")
      .select("id, contact(id, fullName, email)")
      .eq("customerId", customerId),
    client
      .from("customerLocation")
      .select("id, address(id, addressLine1)")
      .eq("customerId", customerId)
  ]);
  const contacts = (contactResult.data ?? []) as any[];
  const locations = (locationResult.data ?? []) as any[];

  pushContact(
    unmatched,
    values,
    "customerContactId",
    "customerContact",
    customerId,
    contacts,
    str(data.purchasingContactName),
    str(data.purchasingContactEmail),
    str(data.purchasingContactPhone)
  );
  pushContact(
    unmatched,
    values,
    "customerEngineeringContactId",
    "customerContact",
    customerId,
    contacts,
    str(data.engineeringContactName),
    str(data.engineeringContactEmail),
    str(data.engineeringContactPhone)
  );

  const addressLine1 = str(data.customerAddressLine1);
  if (addressLine1 || str(data.customerCity)) {
    const { matchedId, options } = matchLocation(locations, addressLine1);
    if (matchedId) values.customerLocationId = matchedId;
    else
      unmatched.push({
        field: "customerLocationId",
        kind: "customerLocation",
        parentId: customerId,
        label: addressLine1 ?? str(data.customerCity)!,
        options,
        prefill: addressPrefill(data, "customer")
      });
  }
  return { values, unmatched };
}

/**
 * Resolve a parent's children (contacts + location) against the PDF, scoped to a
 * now-known parent id. The drawer calls this AFTER the user matches or creates the
 * supplier/customer — so a brand-new parent still gets its contact/location
 * surfaced (fixes the dropped-children dependency-ordering gap).
 */
export function resolveChildren(
  client: Client,
  documentType: AutofillDocumentType,
  data: Extracted,
  parentId: string
): Promise<ChildResolution> {
  return documentType === "purchaseInvoice"
    ? resolveSupplierChildren(client, data, parentId)
    : resolveCustomerChildren(client, data, parentId);
}

export function resolveAutofill(
  client: Client,
  documentType: AutofillDocumentType,
  data: Extracted
): Promise<AutofillResolution> {
  return documentType === "purchaseInvoice"
    ? resolvePurchaseInvoice(client, data)
    : resolveSalesRfq(client, data);
}

/**
 * Re-fetch the candidate options for one entity kind. Used by the autofill modal
 * to refresh a mapping row after the user creates a new record, so the freshly
 * created value can be matched and auto-selected.
 */
export async function fetchEntityOptions(
  client: Client,
  kind: EntityKind,
  parentId?: string
): Promise<MatchableOption[]> {
  switch (kind) {
    case "supplier":
    case "customer": {
      const { data } = await client
        .from(kind)
        .select("id, name")
        .order("name")
        .limit(100);
      return (data ?? []).map((r: any) => ({ label: r.name, value: r.id }));
    }
    case "supplierContact":
    case "customerContact": {
      if (!parentId) return [];
      const parentCol =
        kind === "supplierContact" ? "supplierId" : "customerId";
      const { data } = await client
        .from(kind)
        .select("id, contact(fullName, email)")
        .eq(parentCol, parentId);
      return (data ?? []).map((c: any) => ({
        label: c.contact?.email ?? c.contact?.fullName ?? c.id,
        value: c.id,
        aliases: [c.contact?.fullName, c.contact?.email].filter(
          (a): a is string => !!a
        )
      }));
    }
    case "supplierLocation":
    case "customerLocation": {
      if (!parentId) return [];
      const parentCol =
        kind === "supplierLocation" ? "supplierId" : "customerId";
      const { data } = await client
        .from(kind)
        .select("id, address(addressLine1)")
        .eq(parentCol, parentId);
      return (data ?? []).map((l: any) => ({
        label: l.address?.addressLine1 ?? l.id,
        value: l.id
      }));
    }
  }
}
