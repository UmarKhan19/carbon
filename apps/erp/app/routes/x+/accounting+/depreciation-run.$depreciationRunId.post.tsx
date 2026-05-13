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

  const lines = await client
    .from("depreciationRunLine")
    .select(
      "id, fixedAssetId, amount, fixedAsset:fixedAssetId(id, acquisitionCost, accumulatedDepreciation, residualValuePercent, usefulLifeMonths, fixedAssetClass:fixedAssetClassId(depreciationExpenseAccountId, accumulatedDepreciationAccountId))"
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
