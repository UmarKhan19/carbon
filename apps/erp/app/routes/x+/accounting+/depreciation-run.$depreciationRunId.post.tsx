import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { toStoredAmount } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { depreciationRunId } = params;
  if (!depreciationRunId) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(null, "Missing depreciation run ID"))
    );
  }

  const run = await client
    .from("depreciationRun")
    .select("*")
    .eq("id", depreciationRunId)
    .single();

  if (run.error || run.data.status !== "Draft") {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(run.error, "Run is not in Draft status"))
    );
  }

  const [companySettingsResult, accountDefaultsResult] = await Promise.all([
    client
      .from("companySettings")
      .select("assetTaxDepreciationEnabled, assetTaxRate")
      .eq("id", companyId)
      .single(),
    client
      .from("accountDefault")
      .select("deferredTaxLiabilityAccountId, deferredTaxExpenseAccountId")
      .eq("companyId", companyId)
      .single()
  ]);

  const taxEnabled =
    (companySettingsResult.data as any)?.assetTaxDepreciationEnabled ?? false;
  const taxRate = (companySettingsResult.data as any)?.assetTaxRate
    ? Number((companySettingsResult.data as any).assetTaxRate)
    : null;
  const dtlAccountId = (accountDefaultsResult.data as any)
    ?.deferredTaxLiabilityAccountId;
  const dtExpenseAccountId = (accountDefaultsResult.data as any)
    ?.deferredTaxExpenseAccountId;

  const lines = await client
    .from("depreciationRunLine")
    .select(
      "id, fixedAssetId, amount, taxAmount, fixedAsset:fixedAssetId(id, acquisitionCost, accumulatedDepreciation, accumulatedTaxDepreciation, residualValuePercent, usefulLifeMonths, fixedAssetClass:fixedAssetClassId(depreciationExpenseAccountId, accumulatedDepreciationAccountId))"
    )
    .eq("depreciationRunId", depreciationRunId);

  if (lines.error) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(lines.error, "Failed to fetch run lines"))
    );
  }

  const now = new Date().toISOString();
  const today = now.split("T")[0];

  for (const line of lines.data) {
    const asset = line.fixedAsset as any;
    const assetClass = asset?.fixedAssetClass;
    if (!assetClass) continue;

    const nextSequence = await getNextSequence(
      client,
      "journalEntry",
      companyId
    );
    if (nextSequence.error) continue;

    const journal = await client
      .from("journal")
      .insert({
        journalEntryId: nextSequence.data,
        companyId,
        description: `Depreciation: ${asset.fixedAssetId ?? line.fixedAssetId}`,
        postingDate: today,
        sourceType: "Asset Depreciation" as const,
        status: "Posted" as const,
        postedAt: now,
        postedBy: userId,
        createdBy: userId
      })
      .select("id")
      .single();

    if (journal.error) continue;

    const amount = Number(line.amount);

    const journalLines = [
      {
        journalId: journal.data.id,
        accountId: assetClass.depreciationExpenseAccountId,
        description: "Depreciation Expense",
        amount: toStoredAmount(amount, 0, "Expense"),
        journalLineReference: crypto.randomUUID(),
        companyId
      },
      {
        journalId: journal.data.id,
        accountId: assetClass.accumulatedDepreciationAccountId,
        description: "Accumulated Depreciation",
        amount: toStoredAmount(0, amount, "Asset"),
        journalLineReference: crypto.randomUUID(),
        companyId
      }
    ];

    await client.from("journalLine").insert(journalLines);

    await client
      .from("depreciationRunLine")
      .update({ journalId: journal.data.id })
      .eq("id", line.id);

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

    await client
      .from("fixedAsset")
      .update(assetUpdate)
      .eq("id", line.fixedAssetId);
  }

  // Update accumulated tax depreciation on assets
  if (taxEnabled) {
    for (const line of lines.data) {
      const taxAmount = Number((line as any).taxAmount ?? 0);
      if (taxAmount > 0) {
        const currentTax = Number(
          (line.fixedAsset as any)?.accumulatedTaxDepreciation ?? 0
        );
        await client
          .from("fixedAsset")
          .update({ accumulatedTaxDepreciation: currentTax + taxAmount } as any)
          .eq("id", line.fixedAssetId);
      }
    }
  }

  // Post deferred tax liability journal entry
  if (taxEnabled && taxRate && dtlAccountId && dtExpenseAccountId) {
    let totalTemporaryDifference = 0;
    for (const line of lines.data) {
      const bookAmount = Number(line.amount);
      const taxAmount = Number((line as any).taxAmount ?? bookAmount);
      totalTemporaryDifference += taxAmount - bookAmount;
    }

    const dtlAmount = Math.abs(totalTemporaryDifference * (taxRate / 100));

    if (dtlAmount > 0.01) {
      const dtlSequence = await getNextSequence(
        client,
        "journalEntry",
        companyId
      );
      if (!dtlSequence.error) {
        const dtlJournal = await client
          .from("journal")
          .insert({
            journalEntryId: dtlSequence.data,
            companyId,
            description: `Deferred Tax: Depreciation ${(run.data as any).depreciationRunId ?? depreciationRunId}`,
            postingDate: today,
            sourceType: "Asset Depreciation" as const,
            status: "Posted" as const,
            postedAt: now,
            postedBy: userId,
            createdBy: userId
          })
          .select("id")
          .single();

        if (!dtlJournal.error) {
          if (totalTemporaryDifference > 0) {
            await client.from("journalLine").insert([
              {
                journalId: dtlJournal.data.id,
                accountId: dtExpenseAccountId,
                description: "Deferred Tax Expense",
                amount: toStoredAmount(dtlAmount, 0, "Expense"),
                journalLineReference: crypto.randomUUID(),
                companyId
              },
              {
                journalId: dtlJournal.data.id,
                accountId: dtlAccountId,
                description: "Deferred Tax Liability",
                amount: toStoredAmount(0, dtlAmount, "Liability"),
                journalLineReference: crypto.randomUUID(),
                companyId
              }
            ]);
          } else {
            await client.from("journalLine").insert([
              {
                journalId: dtlJournal.data.id,
                accountId: dtlAccountId,
                description: "Deferred Tax Liability",
                amount: toStoredAmount(dtlAmount, 0, "Liability"),
                journalLineReference: crypto.randomUUID(),
                companyId
              },
              {
                journalId: dtlJournal.data.id,
                accountId: dtExpenseAccountId,
                description: "Deferred Tax Benefit",
                amount: toStoredAmount(0, dtlAmount, "Expense"),
                journalLineReference: crypto.randomUUID(),
                companyId
              }
            ]);
          }
        }
      }
    }
  }

  await client
    .from("depreciationRun")
    .update({
      status: "Posted",
      postedAt: now,
      postedBy: userId
    })
    .eq("id", depreciationRunId);

  throw redirect(
    path.to.depreciationRun(depreciationRunId),
    await flash(request, success("Depreciation run posted"))
  );
}
