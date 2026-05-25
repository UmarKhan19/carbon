import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { toStoredAmount } from "@carbon/utils";
import { interpolateSequenceDate } from "~/utils/string";

async function getNextSequence(
  trx: KyselyTx,
  tableName: string,
  companyId: string
) {
  const sequence = await trx
    .selectFrom("sequence")
    .selectAll()
    .where("table", "=", tableName)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();

  const { prefix, suffix, next, size, step } = sequence;
  if (!Number.isInteger(next)) throw new Error("Next is not an integer");
  if (!Number.isInteger(step)) throw new Error("Step is not an integer");
  if (!Number.isInteger(size)) throw new Error("Size is not an integer");

  const nextValue = next! + step!;
  const nextSequence = nextValue.toString().padStart(size!, "0");
  const derivedPrefix = interpolateSequenceDate(prefix);
  const derivedSuffix = interpolateSequenceDate(suffix);

  await trx
    .updateTable("sequence")
    .set({ next: nextValue, updatedBy: "system" })
    .where("table", "=", tableName)
    .where("companyId", "=", companyId)
    .execute();

  return `${derivedPrefix}${nextSequence}${derivedSuffix}`;
}

export async function postDisposal(
  db: Kysely<KyselyDatabase>,
  args: {
    fixedAssetId: string;
    fixedAssetReadableId: string;
    disposalDate: string;
    disposalMethod: string;
    acquisitionCost: number;
    accumulatedDepreciation: number;
    locationId: string | null;
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
    writeOffAccountId: string;
    accountingPeriodId: string;
    locationDimensionId: string | undefined;
    companyId: string;
    userId: string;
  }
) {
  const {
    fixedAssetId,
    fixedAssetReadableId,
    disposalDate,
    disposalMethod,
    acquisitionCost,
    accumulatedDepreciation,
    locationId,
    assetAccountId,
    accumulatedDepreciationAccountId,
    writeOffAccountId,
    accountingPeriodId,
    locationDimensionId,
    companyId,
    userId
  } = args;

  const nbv = acquisitionCost - accumulatedDepreciation;
  const now = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    const journalEntryId = await getNextSequence(
      trx,
      "journalEntry",
      companyId
    );

    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId,
        accountingPeriodId,
        companyId,
        description: `Asset Disposal: ${fixedAssetReadableId} (${disposalMethod})`,
        postingDate: disposalDate,
        sourceType: "Asset Disposal",
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalLines: Array<{
      journalId: string;
      accountId: string;
      description: string;
      amount: number;
      journalLineReference: string;
      companyId: string;
    }> = [];

    if (accumulatedDepreciation > 0) {
      journalLines.push({
        journalId: journal.id,
        accountId: accumulatedDepreciationAccountId,
        description: "Clear accumulated depreciation",
        amount: toStoredAmount(accumulatedDepreciation, 0, "Asset"),
        journalLineReference: crypto.randomUUID(),
        companyId
      });
    }

    if (nbv > 0) {
      journalLines.push({
        journalId: journal.id,
        accountId: writeOffAccountId,
        description: "Write-off remaining book value",
        amount: toStoredAmount(nbv, 0, "Expense"),
        journalLineReference: crypto.randomUUID(),
        companyId
      });
    }

    journalLines.push({
      journalId: journal.id,
      accountId: assetAccountId,
      description: "Remove asset at cost",
      amount: toStoredAmount(0, acquisitionCost, "Asset"),
      journalLineReference: crypto.randomUUID(),
      companyId
    });

    const journalLineResults = await trx
      .insertInto("journalLine")
      .values(journalLines)
      .returning(["id"])
      .execute();

    if (locationDimensionId && locationId) {
      await trx
        .insertInto("journalLineDimension")
        .values(
          journalLineResults.map((jl) => ({
            journalLineId: jl.id,
            dimensionId: locationDimensionId,
            valueId: locationId,
            companyId
          }))
        )
        .execute();
    }

    await trx
      .insertInto("fixedAssetDisposal")
      .values({
        fixedAssetId,
        disposalMethod,
        disposalDate,
        saleProceeds: 0,
        netBookValueAtDisposal: nbv,
        gainLoss: -nbv,
        journalId: journal.id,
        companyId,
        createdBy: userId
      })
      .execute();

    await trx
      .updateTable("fixedAsset")
      .set({
        status: "Disposed",
        disposalDate,
        disposalMethod,
        saleProceeds: 0,
        updatedBy: userId
      })
      .where("id", "=", fixedAssetId)
      .execute();
  });
}

type DepreciationRunLine = {
  id: string;
  fixedAssetId: string;
  amount: number;
  taxAmount: number;
  asset: {
    fixedAssetId: string;
    locationId: string | null;
    acquisitionCost: number;
    accumulatedDepreciation: number;
    accumulatedTaxDepreciation: number;
    residualValuePercent: number;
    depreciationExpenseAccountId: string;
    accumulatedDepreciationAccountId: string;
  };
};

export async function postDepreciationRun(
  db: Kysely<KyselyDatabase>,
  args: {
    depreciationRunId: string;
    depreciationRunReadableId: string;
    postingDate: string;
    accountingPeriodId: string;
    lines: DepreciationRunLine[];
    locationDimensionId: string | undefined;
    taxEnabled: boolean;
    taxRate: number | null;
    dtlAccountId: string | null;
    dtExpenseAccountId: string | null;
    companyId: string;
    userId: string;
  }
) {
  const {
    depreciationRunId,
    depreciationRunReadableId,
    postingDate,
    accountingPeriodId,
    lines,
    locationDimensionId,
    taxEnabled,
    taxRate,
    dtlAccountId,
    dtExpenseAccountId,
    companyId,
    userId
  } = args;

  const now = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    for (const line of lines) {
      const { asset } = line;
      const amount = Number(line.amount);

      const journalEntryId = await getNextSequence(
        trx,
        "journalEntry",
        companyId
      );

      const journal = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          accountingPeriodId,
          companyId,
          description: `Depreciation: ${asset.fixedAssetId}`,
          postingDate,
          sourceType: "Asset Depreciation",
          status: "Posted",
          postedAt: now,
          postedBy: userId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      const journalLineResults = await trx
        .insertInto("journalLine")
        .values([
          {
            journalId: journal.id,
            accountId: asset.depreciationExpenseAccountId,
            description: "Depreciation Expense",
            amount: toStoredAmount(amount, 0, "Expense"),
            journalLineReference: crypto.randomUUID(),
            companyId
          },
          {
            journalId: journal.id,
            accountId: asset.accumulatedDepreciationAccountId,
            description: "Accumulated Depreciation",
            amount: toStoredAmount(0, amount, "Asset"),
            journalLineReference: crypto.randomUUID(),
            companyId
          }
        ])
        .returning(["id"])
        .execute();

      if (locationDimensionId && asset.locationId) {
        await trx
          .insertInto("journalLineDimension")
          .values(
            journalLineResults.map((jl) => ({
              journalLineId: jl.id,
              dimensionId: locationDimensionId,
              valueId: asset.locationId!,
              companyId
            }))
          )
          .execute();
      }

      await trx
        .updateTable("depreciationRunLine")
        .set({ journalId: journal.id })
        .where("id", "=", line.id)
        .execute();

      const newAccumulated = Number(asset.accumulatedDepreciation) + amount;
      const cost = Number(asset.acquisitionCost);
      const residualValue = cost * (Number(asset.residualValuePercent) / 100);
      const nbv = cost - newAccumulated;

      const assetUpdate: Record<string, any> = {
        accumulatedDepreciation: newAccumulated,
        updatedBy: userId
      };

      if (nbv <= residualValue + 0.01) {
        assetUpdate.status = "Fully Depreciated";
      }

      if (taxEnabled) {
        const taxAmount = Number(line.taxAmount ?? 0);
        if (taxAmount > 0) {
          const currentTax = Number(asset.accumulatedTaxDepreciation ?? 0);
          assetUpdate.accumulatedTaxDepreciation = currentTax + taxAmount;
        }
      }

      await trx
        .updateTable("fixedAsset")
        .set(assetUpdate)
        .where("id", "=", line.fixedAssetId)
        .execute();
    }

    // Deferred tax liability journal entry
    if (taxEnabled && taxRate && dtlAccountId && dtExpenseAccountId) {
      let totalTemporaryDifference = 0;
      for (const line of lines) {
        const bookAmount = Number(line.amount);
        const taxAmt = Number(line.taxAmount ?? bookAmount);
        totalTemporaryDifference += taxAmt - bookAmount;
      }

      const dtlAmount = Math.abs(totalTemporaryDifference * (taxRate / 100));

      if (dtlAmount > 0.01) {
        const dtlEntryId = await getNextSequence(
          trx,
          "journalEntry",
          companyId
        );

        const dtlJournal = await trx
          .insertInto("journal")
          .values({
            journalEntryId: dtlEntryId,
            accountingPeriodId,
            companyId,
            description: `Deferred Tax: Depreciation ${depreciationRunReadableId}`,
            postingDate,
            sourceType: "Asset Depreciation",
            status: "Posted",
            postedAt: now,
            postedBy: userId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        const isLiability = totalTemporaryDifference > 0;

        await trx
          .insertInto("journalLine")
          .values([
            {
              journalId: dtlJournal.id,
              accountId: isLiability ? dtExpenseAccountId : dtlAccountId,
              description: isLiability
                ? "Deferred Tax Expense"
                : "Deferred Tax Liability",
              amount: toStoredAmount(
                dtlAmount,
                0,
                isLiability ? "Expense" : "Liability"
              ),
              journalLineReference: crypto.randomUUID(),
              companyId
            },
            {
              journalId: dtlJournal.id,
              accountId: isLiability ? dtlAccountId : dtExpenseAccountId,
              description: isLiability
                ? "Deferred Tax Liability"
                : "Deferred Tax Benefit",
              amount: toStoredAmount(
                0,
                dtlAmount,
                isLiability ? "Liability" : "Expense"
              ),
              journalLineReference: crypto.randomUUID(),
              companyId
            }
          ])
          .execute();
      }
    }

    await trx
      .updateTable("depreciationRun")
      .set({
        status: "Posted",
        postedAt: now,
        postedBy: userId
      })
      .where("id", "=", depreciationRunId)
      .execute();
  });
}
