import type { Database } from "@carbon/database";
import type {
  getPriceList,
  getPriceListAssignments,
  getPriceListItem,
  getPriceListItemBreaks,
  getPriceListItems,
  getPriceListRule,
  getPriceListRules,
  getPriceLists,
  getPriceListVersions
} from "./pricing.service";

export type PriceList = NonNullable<
  Awaited<ReturnType<typeof getPriceLists>>["data"]
>[number];

export type PriceListDetail = NonNullable<
  Awaited<ReturnType<typeof getPriceList>>["data"]
>;

export type PriceListItem = NonNullable<
  Awaited<ReturnType<typeof getPriceListItems>>["data"]
>[number];

export type PriceListItemDetail = NonNullable<
  Awaited<ReturnType<typeof getPriceListItem>>["data"]
>;

export type PriceListItemBreak = NonNullable<
  Awaited<ReturnType<typeof getPriceListItemBreaks>>["data"]
>[number];

export type PriceListRule = NonNullable<
  Awaited<ReturnType<typeof getPriceListRules>>["data"]
>[number];

export type PriceListRuleDetail = NonNullable<
  Awaited<ReturnType<typeof getPriceListRule>>["data"]
>;

export type PriceListAssignment = NonNullable<
  Awaited<ReturnType<typeof getPriceListAssignments>>["data"]
>[number];

export type PriceListVersion = NonNullable<
  Awaited<ReturnType<typeof getPriceListVersions>>["data"]
>[number];

export type PriceListStatusType =
  Database["public"]["Enums"]["priceListStatus"];

export type PriceListTypeType = Database["public"]["Enums"]["priceListType"];

export type PriceListRuleType =
  Database["public"]["Enums"]["priceListRuleType"];

export type PriceListRuleAmountType =
  Database["public"]["Enums"]["priceListRuleAmountType"];

export type PriceListPriceType =
  Database["public"]["Enums"]["priceListPriceType"];
