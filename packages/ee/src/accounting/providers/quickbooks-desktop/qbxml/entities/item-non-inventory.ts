import { buildRequestElement } from "../envelope";
import {
  assertQbdName,
  buildAccountRefXml,
  buildListQueryRqXml,
  element,
  formatAmount,
  optionalElement,
  parseListRet,
  QBD_ITEM_NAME_MAX_LENGTH,
  type QbdListRet,
  type QbdRef
} from "./shared";

/**
 * ItemNonInventoryAdd / Mod / Query builders + ItemNonInventoryRet parser.
 *
 * Carbon items map 1:1 to NON-INVENTORY items (research: QuickBooks'
 * own inventory tracking stays OFF — Carbon owns inventory; pushing
 * ItemInventory would double-book COGS/asset movements). Items always use
 * the SalesAndPurchase block (bought AND sold) with the mapped income and
 * expense/COGS account refs — always by ListID from the account mapping,
 * FullName only as the pre-resolution fallback (UNMAPPED_ACCOUNTS Warning
 * when neither is present).
 *
 * Item names cap at 31 chars per hierarchy level (NAME_TOO_LONG Warning).
 * Element order per the OSR: Name, then SalesAndPurchase(SalesDesc,
 * SalesPrice, IncomeAccountRef, PurchaseDesc, PurchaseCost,
 * ExpenseAccountRef).
 */

export interface QbdItemNonInventoryInput {
  name: string;
  salesDescription?: string | null;
  salesPrice?: number | null;
  incomeAccountRef: QbdRef;
  purchaseDescription?: string | null;
  purchaseCost?: number | null;
  expenseAccountRef: QbdRef;
}

function buildSalesAndPurchaseXml(
  item: QbdItemNonInventoryInput,
  mod: boolean
): string {
  const tag = mod ? "SalesAndPurchaseMod" : "SalesAndPurchase";
  return `<${tag}>${optionalElement("SalesDesc", item.salesDescription)}${
    item.salesPrice != null
      ? element("SalesPrice", formatAmount(item.salesPrice))
      : ""
  }${buildAccountRefXml(
    "IncomeAccountRef",
    item.incomeAccountRef,
    "the item income account"
  )}${optionalElement("PurchaseDesc", item.purchaseDescription)}${
    item.purchaseCost != null
      ? element("PurchaseCost", formatAmount(item.purchaseCost))
      : ""
  }${buildAccountRefXml(
    "ExpenseAccountRef",
    item.expenseAccountRef,
    "the item expense (COGS) account"
  )}</${tag}>`;
}

export function buildAddRq(args: {
  requestID: string;
  item: QbdItemNonInventoryInput;
}): string {
  assertQbdName(args.item.name, QBD_ITEM_NAME_MAX_LENGTH, "item name");
  const inner = `<ItemNonInventoryAdd>${element(
    "Name",
    args.item.name
  )}${buildSalesAndPurchaseXml(args.item, false)}</ItemNonInventoryAdd>`;
  return buildRequestElement("ItemNonInventoryAddRq", args.requestID, inner);
}

export function buildModRq(args: {
  requestID: string;
  listId: string;
  editSequence: string;
  item: QbdItemNonInventoryInput;
}): string {
  assertQbdName(args.item.name, QBD_ITEM_NAME_MAX_LENGTH, "item name");
  const inner = `<ItemNonInventoryMod>${element("ListID", args.listId)}${element(
    "EditSequence",
    args.editSequence
  )}${element("Name", args.item.name)}${buildSalesAndPurchaseXml(
    args.item,
    true
  )}</ItemNonInventoryMod>`;
  return buildRequestElement("ItemNonInventoryModRq", args.requestID, inner);
}

export function buildQueryRq(args: {
  requestID: string;
  fullName: string;
}): string {
  return buildListQueryRqXml("ItemNonInventoryQueryRq", args);
}

export function parseRet(payload: unknown): QbdListRet | null {
  return parseListRet(payload, "ItemNonInventoryRet");
}
