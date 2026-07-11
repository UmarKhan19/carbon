import type { Accounting } from "../../../core/types";
import type { QbdItemNonInventoryInput } from "../qbxml/entities/item-non-inventory";
import * as itemNonInventory from "../qbxml/entities/item-non-inventory";
import {
  assertQbdName,
  QBD_ITEM_NAME_MAX_LENGTH
} from "../qbxml/entities/shared";
import type { QbxmlResponse } from "../qbxml/parse";
import {
  loadQbdAccountListIdsById,
  type QbdBuildRequestResult,
  QbdEntitySyncer,
  type QbdOperationInput,
  type QbdProcessResponseResult
} from "./shared";

/**
 * QbdItemSyncer — Carbon items → QuickBooks Desktop NON-INVENTORY items
 * (push-only v1; QuickBooks' own inventory tracking stays off — Carbon
 * owns inventory). The QB item Name carries the Carbon item CODE
 * (readableIdWithRevision), mirroring the QBO item syncer, and is the
 * FullName the query-before-insert probe matches on. Items always use the
 * SalesAndPurchase block with the mapped income and expense/COGS account
 * ListIDs resolved from the item posting defaults
 * (accountDefault.salesAccount / costOfGoodsSoldAccount) through the
 * account mapping — an unmapped/missing default account fails
 * UNMAPPED_ACCOUNTS (Warning).
 */

type ItemRow = {
  id: string;
  readableId: string;
  readableIdWithRevision: string | null;
  name: string;
  description: string | null;
  companyId: string | null;
  type: Accounting.Item["type"];
  unitOfMeasureCode: string | null;
  replenishmentSystem: string | null;
  itemTrackingType: string | null;
  updatedAt: string | null;
  unitCost: number | null;
  unitSalePrice: number | null;
};

/**
 * Map a Carbon item to the QBD ItemNonInventoryAdd/Mod input. Pure —
 * exported for tests. Name = the item code (31-char/level cap asserted by
 * the caller and the builders); descriptions fall back to the item name;
 * account refs are the mapped ListIDs (null → the builder throws
 * UNMAPPED_ACCOUNTS).
 */
export function toQbdItemInput(
  local: Accounting.Item,
  accounts: { incomeListId: string | null; expenseListId: string | null }
): QbdItemNonInventoryInput {
  return {
    name: local.code,
    salesDescription: local.description ?? local.name,
    salesPrice: local.unitSalePrice,
    incomeAccountRef: { listId: accounts.incomeListId },
    purchaseDescription: local.description ?? local.name,
    purchaseCost: local.unitCost,
    expenseAccountRef: { listId: accounts.expenseListId }
  };
}

export class QbdItemSyncer extends QbdEntitySyncer<Accounting.Item> {
  // Cached per instance — a QBWC batch reuses one syncer across its
  // claimed operations
  private accountListIdsByIdPromise?: Promise<Map<string, string>>;
  private defaultItemAccountsPromise?: Promise<{
    incomeAccountId: string | null;
    expenseAccountId: string | null;
  }>;

  private getAccountListIdsById(): Promise<Map<string, string>> {
    if (!this.accountListIdsByIdPromise) {
      this.accountListIdsByIdPromise = loadQbdAccountListIdsById(
        this.database,
        { companyId: this.companyId, integration: this.provider.id }
      );
    }
    return this.accountListIdsByIdPromise;
  }

  /**
   * The item posting defaults (items carry no per-item posting accounts):
   * accountDefault.salesAccount → income, costOfGoodsSoldAccount →
   * expense. Same source as the QBO item syncer.
   */
  private getDefaultItemAccounts(): Promise<{
    incomeAccountId: string | null;
    expenseAccountId: string | null;
  }> {
    if (!this.defaultItemAccountsPromise) {
      this.defaultItemAccountsPromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select(["salesAccount", "costOfGoodsSoldAccount"])
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return {
          incomeAccountId: defaults?.salesAccount ?? null,
          expenseAccountId: defaults?.costOfGoodsSoldAccount ?? null
        };
      })();
    }
    return this.defaultItemAccountsPromise;
  }

  async buildRequest(op: QbdOperationInput): Promise<QbdBuildRequestResult> {
    return this.runBuild(async () => {
      const local = await this.fetchLocal(op.entityId);
      if (!local) {
        throw new Error(`Item ${op.entityId} not found in Carbon`);
      }

      assertQbdName(local.code, QBD_ITEM_NAME_MAX_LENGTH, "item name");

      const accountListIdsById = await this.getAccountListIdsById();
      const { incomeAccountId, expenseAccountId } =
        await this.getDefaultItemAccounts();

      const input = toQbdItemInput(local, {
        incomeListId: incomeAccountId
          ? (accountListIdsById.get(incomeAccountId) ?? null)
          : null,
        expenseListId: expenseAccountId
          ? (accountListIdsById.get(expenseAccountId) ?? null)
          : null
      });

      return this.buildListRequest(op, {
        buildQueryRq: (requestID) =>
          itemNonInventory.buildQueryRq({ requestID, fullName: local.code }),
        buildAddRq: (requestID) =>
          itemNonInventory.buildAddRq({ requestID, item: input }),
        buildModRq: (requestID, listId, editSequence) =>
          itemNonInventory.buildModRq({
            requestID,
            listId,
            editSequence,
            item: input
          })
      });
    });
  }

  async processResponse(
    op: QbdOperationInput,
    response: QbxmlResponse
  ): Promise<QbdProcessResponseResult> {
    return this.processListResponse(op, response, {
      parseRet: itemNonInventory.parseRet,
      entityLabel: "item"
    });
  }

  async fetchLocal(id: string): Promise<Accounting.Item | null> {
    const rows = await this.database
      .selectFrom("item")
      .leftJoin("itemCost", "itemCost.itemId", "item.id")
      .leftJoin("itemUnitSalePrice", "itemUnitSalePrice.itemId", "item.id")
      .select([
        "item.id",
        "item.readableId",
        "item.readableIdWithRevision",
        "item.name",
        "item.description",
        "item.companyId",
        "item.type",
        "item.unitOfMeasureCode",
        "item.replenishmentSystem",
        "item.itemTrackingType",
        "item.updatedAt",
        "itemCost.unitCost",
        "itemUnitSalePrice.unitSalePrice"
      ])
      .where("item.id", "=", id)
      .where("item.companyId", "=", this.companyId)
      .execute();

    const row = (rows as ItemRow[])[0];
    if (!row) return null;

    const isPurchased =
      row.replenishmentSystem === "Buy" ||
      row.replenishmentSystem === "Buy and Make";

    return {
      id: row.id,
      code: row.readableIdWithRevision ?? row.readableId,
      name: row.name,
      description: row.description,
      companyId: row.companyId!,
      type: row.type,
      unitOfMeasureCode: row.unitOfMeasureCode,
      unitCost: Number(row.unitCost) || 0,
      unitSalePrice: Number(row.unitSalePrice) || 0,
      isPurchased,
      isSold: true, // Xero/QBO parity: all items can be sold
      isTrackedAsInventory: row.itemTrackingType !== "None",
      updatedAt: row.updatedAt ?? new Date().toISOString(),
      raw: row
    };
  }
}
