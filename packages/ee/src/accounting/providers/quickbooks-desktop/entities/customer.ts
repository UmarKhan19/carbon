import type { Accounting } from "../../../core/types";
import type { QbdCustomerInput } from "../qbxml/entities/customer";
import * as customer from "../qbxml/entities/customer";
import {
  assertQbdName,
  QBD_LIST_NAME_MAX_LENGTH
} from "../qbxml/entities/shared";
import type { QbxmlResponse } from "../qbxml/parse";
import {
  type QbdBuildRequestResult,
  QbdEntitySyncer,
  type QbdOperationInput,
  type QbdProcessResponseResult
} from "./shared";

/**
 * QbdCustomerSyncer — Carbon customers → QuickBooks Desktop Customer list
 * entries (push-only v1). List flow per entities/shared.ts: unmapped ops
 * query by FullName first (hit → link + Mod with Carbon fields, miss →
 * Add); mapped ops Mod directly with the stored EditSequence.
 *
 * fetchLocal mirrors the QBO customer syncer's joins (customer +
 * customerTax + customerLocation/address + customerContact/contact) onto
 * the shared Accounting.Contact shape.
 */

// Row shape for the customer fetch (same joins as the QBO/Xero syncers)
type CustomerRow = {
  id: string;
  name: string;
  companyId: string;
  taxId: string | null;
  phone: string | null;
  fax: string | null;
  website: string | null;
  currencyCode: string | null;
  updatedAt: string | null;
  locationName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactEmail: string | null;
  contactMobilePhone: string | null;
  contactHomePhone: string | null;
  contactWorkPhone: string | null;
};

/**
 * Map a Carbon contact to the QBD CustomerAdd/Mod input. Pure — exported
 * for tests. Name → Name (the 41-char/level cap is asserted by the caller
 * and the builders); CompanyName is omitted (Carbon customers are
 * companies — Name already carries it); phone falls back workPhone →
 * mobilePhone → homePhone (QBO parity); the first address becomes
 * BillAddress.
 */
export function toQbdCustomerInput(
  local: Accounting.Contact
): QbdCustomerInput {
  const address = local.addresses[0];

  return {
    name: local.name,
    phone: local.workPhone ?? local.mobilePhone ?? local.homePhone ?? null,
    email: local.email ?? null,
    billingAddress: address
      ? {
          line1: address.line1 ?? null,
          line2: address.line2 ?? null,
          city: address.city ?? null,
          state: address.region ?? null,
          postalCode: address.postalCode ?? null,
          country: address.country ?? null
        }
      : null
  };
}

export class QbdCustomerSyncer extends QbdEntitySyncer<Accounting.Contact> {
  async buildRequest(op: QbdOperationInput): Promise<QbdBuildRequestResult> {
    return this.runBuild(async () => {
      const local = await this.fetchLocal(op.entityId);
      if (!local) {
        throw new Error(`Customer ${op.entityId} not found in Carbon`);
      }

      // Fail NAME_TOO_LONG before spending a query round trip
      assertQbdName(local.name, QBD_LIST_NAME_MAX_LENGTH, "customer name");
      const input = toQbdCustomerInput(local);

      return this.buildListRequest(op, {
        buildQueryRq: (requestID) =>
          customer.buildQueryRq({ requestID, fullName: local.name }),
        buildAddRq: (requestID) =>
          customer.buildAddRq({ requestID, customer: input }),
        buildModRq: (requestID, listId, editSequence) =>
          customer.buildModRq({
            requestID,
            listId,
            editSequence,
            customer: input
          })
      });
    });
  }

  async processResponse(
    op: QbdOperationInput,
    response: QbxmlResponse
  ): Promise<QbdProcessResponseResult> {
    return this.processListResponse(op, response, {
      parseRet: customer.parseRet,
      entityLabel: "customer"
    });
  }

  async fetchLocal(id: string): Promise<Accounting.Contact | null> {
    const rows = await (this.database as any)
      .selectFrom("customer")
      .leftJoin("customerTax", "customerTax.customerId", "customer.id")
      .leftJoin(
        "customerLocation",
        "customerLocation.customerId",
        "customer.id"
      )
      .leftJoin("address", "address.id", "customerLocation.addressId")
      .leftJoin("customerContact", "customerContact.customerId", "customer.id")
      .leftJoin("contact", "contact.id", "customerContact.contactId")
      .select([
        "customer.id",
        "customer.name",
        "customer.companyId",
        "customerTax.taxId as taxId",
        "customer.phone",
        "customer.fax",
        "customer.website",
        "customer.currencyCode",
        "customer.updatedAt",
        "customerLocation.name as locationName",
        "address.addressLine1",
        "address.addressLine2",
        "address.city",
        "address.postalCode",
        "contact.firstName as contactFirstName",
        "contact.lastName as contactLastName",
        "contact.email as contactEmail",
        "contact.mobilePhone as contactMobilePhone",
        "contact.homePhone as contactHomePhone",
        "contact.workPhone as contactWorkPhone"
      ])
      .where("customer.id", "=", id)
      .where("customer.companyId", "=", this.companyId)
      .execute();

    const typed = rows as CustomerRow[];
    const first = typed[0];
    if (!first) return null;

    const addresses = typed
      .filter((row) => row.addressLine1 || row.city)
      .map((row) => ({
        label: row.locationName ?? null,
        type: null,
        line1: row.addressLine1 ?? null,
        line2: row.addressLine2 ?? null,
        city: row.city ?? null,
        country: null,
        region: null,
        postalCode: row.postalCode ?? null
      }));

    return {
      id: first.id,
      name: first.name,
      firstName: first.contactFirstName ?? "",
      lastName: first.contactLastName ?? "",
      companyId: first.companyId,
      email: first.contactEmail ?? undefined,
      website: first.website ?? null,
      taxId: first.taxId ?? null,
      currencyCode: first.currencyCode ?? "USD",
      balance: null,
      creditLimit: null,
      paymentTerms: null,
      updatedAt: first.updatedAt ?? new Date().toISOString(),
      workPhone: first.contactWorkPhone ?? first.phone ?? null,
      mobilePhone: first.contactMobilePhone ?? null,
      fax: first.fax ?? null,
      homePhone: first.contactHomePhone ?? null,
      isVendor: false,
      isCustomer: true,
      addresses,
      raw: first
    };
  }
}
