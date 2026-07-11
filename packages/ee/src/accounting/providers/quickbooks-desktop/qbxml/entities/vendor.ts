import { buildRequestElement } from "../envelope";
import {
  assertQbdName,
  buildAddressXml,
  buildListQueryRqXml,
  element,
  optionalElement,
  parseListRet,
  QBD_LIST_NAME_MAX_LENGTH,
  type QbdAddressInput,
  type QbdListRet
} from "./shared";

/**
 * VendorAdd / VendorMod / VendorQuery builders + VendorRet parser.
 *
 * Mirrors customer.ts (QuickBooks Desktop keeps vendors as a separate
 * list, but the same 41-char-per-level name cap and the shared name
 * namespace apply). The vendor's billing address element is
 * `VendorAddress`, not `BillAddress`. Element order per the OSR:
 * Name, CompanyName, VendorAddress, Phone, Email.
 */

export interface QbdVendorInput {
  name: string;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: QbdAddressInput | null;
}

function buildVendorFieldsXml(vendor: QbdVendorInput): string {
  assertQbdName(vendor.name, QBD_LIST_NAME_MAX_LENGTH, "vendor name");
  return [
    element("Name", vendor.name),
    optionalElement("CompanyName", vendor.companyName),
    buildAddressXml("VendorAddress", vendor.address, "vendor"),
    optionalElement("Phone", vendor.phone),
    optionalElement("Email", vendor.email)
  ].join("");
}

export function buildAddRq(args: {
  requestID: string;
  vendor: QbdVendorInput;
}): string {
  return buildRequestElement(
    "VendorAddRq",
    args.requestID,
    `<VendorAdd>${buildVendorFieldsXml(args.vendor)}</VendorAdd>`
  );
}

export function buildModRq(args: {
  requestID: string;
  listId: string;
  editSequence: string;
  vendor: QbdVendorInput;
}): string {
  const inner = `<VendorMod>${element("ListID", args.listId)}${element(
    "EditSequence",
    args.editSequence
  )}${buildVendorFieldsXml(args.vendor)}</VendorMod>`;
  return buildRequestElement("VendorModRq", args.requestID, inner);
}

export function buildQueryRq(args: {
  requestID: string;
  fullName: string;
}): string {
  return buildListQueryRqXml("VendorQueryRq", args);
}

export function parseRet(payload: unknown): QbdListRet | null {
  return parseListRet(payload, "VendorRet");
}
