import type { Accounting } from "../../../core/types";
import {
  assertQbdName,
  QBD_LIST_NAME_MAX_LENGTH
} from "../qbxml/entities/shared";
import type { QbdVendorInput } from "../qbxml/entities/vendor";
import * as vendor from "../qbxml/entities/vendor";
import type { QbxmlResponse } from "../qbxml/parse";
import {
  type QbdBuildRequestResult,
  QbdEntitySyncer,
  type QbdOperationInput,
  type QbdProcessResponseResult
} from "./shared";

/**
 * QbdVendorSyncer — Carbon suppliers → QuickBooks Desktop Vendor list
 * entries (push-only v1). Mirrors QbdCustomerSyncer with the supplier
 * tables; mapping rows live under entityType "vendor". Same list flow:
 * unmapped → query by FullName (hit → link + Mod, miss → Add); mapped →
 * Mod with the stored EditSequence.
 */

type SupplierRow = {
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
 * Map a Carbon supplier contact to the QBD VendorAdd/Mod input. Pure —
 * exported for tests. Same conventions as toQbdCustomerInput (CompanyName
 * omitted, phone fallback chain, first address → VendorAddress).
 */
export function toQbdVendorInput(local: Accounting.Contact): QbdVendorInput {
  const address = local.addresses[0];

  return {
    name: local.name,
    phone: local.workPhone ?? local.mobilePhone ?? local.homePhone ?? null,
    email: local.email ?? null,
    address: address
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

export class QbdVendorSyncer extends QbdEntitySyncer<Accounting.Contact> {
  async buildRequest(op: QbdOperationInput): Promise<QbdBuildRequestResult> {
    return this.runBuild(async () => {
      const local = await this.fetchLocal(op.entityId);
      if (!local) {
        throw new Error(`Supplier ${op.entityId} not found in Carbon`);
      }

      assertQbdName(local.name, QBD_LIST_NAME_MAX_LENGTH, "vendor name");
      const input = toQbdVendorInput(local);

      return this.buildListRequest(op, {
        buildQueryRq: (requestID) =>
          vendor.buildQueryRq({ requestID, fullName: local.name }),
        buildAddRq: (requestID) =>
          vendor.buildAddRq({ requestID, vendor: input }),
        buildModRq: (requestID, listId, editSequence) =>
          vendor.buildModRq({ requestID, listId, editSequence, vendor: input })
      });
    });
  }

  async processResponse(
    op: QbdOperationInput,
    response: QbxmlResponse
  ): Promise<QbdProcessResponseResult> {
    return this.processListResponse(op, response, {
      parseRet: vendor.parseRet,
      entityLabel: "vendor"
    });
  }

  async fetchLocal(id: string): Promise<Accounting.Contact | null> {
    const rows = await (this.database as any)
      .selectFrom("supplier")
      .leftJoin("supplierTax", "supplierTax.supplierId", "supplier.id")
      .leftJoin(
        "supplierLocation",
        "supplierLocation.supplierId",
        "supplier.id"
      )
      .leftJoin("address", "address.id", "supplierLocation.addressId")
      .leftJoin("supplierContact", "supplierContact.supplierId", "supplier.id")
      .leftJoin("contact", "contact.id", "supplierContact.contactId")
      .select([
        "supplier.id",
        "supplier.name",
        "supplier.companyId",
        "supplierTax.taxId as taxId",
        "supplier.phone",
        "supplier.fax",
        "supplier.website",
        "supplier.currencyCode",
        "supplier.updatedAt",
        "supplierLocation.name as locationName",
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
      .where("supplier.id", "=", id)
      .where("supplier.companyId", "=", this.companyId)
      .execute();

    const typed = rows as SupplierRow[];
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
      isVendor: true,
      isCustomer: false,
      addresses,
      raw: first
    };
  }
}
