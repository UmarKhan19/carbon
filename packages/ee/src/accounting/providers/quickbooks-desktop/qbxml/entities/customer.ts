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
 * CustomerAdd / CustomerMod / CustomerQuery builders + CustomerRet parser.
 *
 * Two-way-capable list entity: query-before-insert matches by FullName
 * (buildQueryRq); a hit updates via buildModRq with the stored
 * ListID + EditSequence, a miss inserts via buildAddRq. Name ≤ 41 chars
 * per hierarchy level (NAME_TOO_LONG Warning otherwise) — QuickBooks
 * names share ONE namespace across customers, vendors, employees and
 * other names, so a 3100 on Add means ANY list already uses the name.
 *
 * Element order (Name, CompanyName, BillAddress, Phone, Email) follows the
 * qbXML OSR — QuickBooks rejects out-of-order elements.
 */

export interface QbdCustomerInput {
  name: string;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  billingAddress?: QbdAddressInput | null;
}

function buildCustomerFieldsXml(customer: QbdCustomerInput): string {
  assertQbdName(customer.name, QBD_LIST_NAME_MAX_LENGTH, "customer name");
  return [
    element("Name", customer.name),
    optionalElement("CompanyName", customer.companyName),
    buildAddressXml("BillAddress", customer.billingAddress, "customer"),
    optionalElement("Phone", customer.phone),
    optionalElement("Email", customer.email)
  ].join("");
}

export function buildAddRq(args: {
  requestID: string;
  customer: QbdCustomerInput;
}): string {
  return buildRequestElement(
    "CustomerAddRq",
    args.requestID,
    `<CustomerAdd>${buildCustomerFieldsXml(args.customer)}</CustomerAdd>`
  );
}

export function buildModRq(args: {
  requestID: string;
  listId: string;
  editSequence: string;
  customer: QbdCustomerInput;
}): string {
  const inner = `<CustomerMod>${element("ListID", args.listId)}${element(
    "EditSequence",
    args.editSequence
  )}${buildCustomerFieldsXml(args.customer)}</CustomerMod>`;
  return buildRequestElement("CustomerModRq", args.requestID, inner);
}

export function buildQueryRq(args: {
  requestID: string;
  fullName: string;
}): string {
  return buildListQueryRqXml("CustomerQueryRq", args);
}

export function parseRet(payload: unknown): QbdListRet | null {
  return parseListRet(payload, "CustomerRet");
}
