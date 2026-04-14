import { getDatabaseClient } from "~/services/database.server";

export async function upsertItemSalePriceBreaks(
  itemId: string,
  companyId: string,
  userId: string,
  breaks: Array<{
    minQuantity: number;
    unitPrice?: number;
    discountPercent?: number;
    customerTypeId?: string;
  }>,
  customerTypeId?: string | null
) {
  const db = getDatabaseClient();
  await db.transaction().execute(async (trx) => {
    let deleteQuery = trx
      .deleteFrom("itemSalePriceBreak")
      .where("itemId", "=", itemId)
      .where("companyId", "=", companyId);

    if (customerTypeId) {
      deleteQuery = deleteQuery.where("customerTypeId", "=", customerTypeId);
    } else {
      deleteQuery = deleteQuery.where("customerTypeId", "is", null);
    }

    await deleteQuery.execute();

    if (breaks.length === 0) return;

    await trx
      .insertInto("itemSalePriceBreak")
      .values(
        breaks.map((b) => ({
          itemId,
          minQuantity: b.minQuantity,
          unitPrice: b.unitPrice ?? null,
          discountPercent: b.discountPercent ?? null,
          customerTypeId: b.customerTypeId ?? customerTypeId ?? null,
          companyId,
          createdBy: userId
        }))
      )
      .execute();
  });
}

export async function deleteItemSalePriceBreaksByCustomerType(
  itemId: string,
  companyId: string,
  customerTypeId: string
) {
  const db = getDatabaseClient();
  await db
    .deleteFrom("itemSalePriceBreak")
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .where("customerTypeId", "=", customerTypeId)
    .execute();
}
