import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { toStoredAmount } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetDisposalValidator,
  getFixedAsset
} from "~/modules/accounting";
import { FixedAssetDisposalForm } from "~/modules/accounting/ui/FixedAssets";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const asset = await getFixedAsset(client, fixedAssetId);
  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  if (
    asset.data.status !== "Active" &&
    asset.data.status !== "Fully Depreciated"
  ) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(null, "Only Active or Fully Depreciated assets can be disposed")
      )
    );
  }

  const nbv =
    Number(asset.data.acquisitionCost) -
    Number(asset.data.accumulatedDepreciation);

  return { asset: asset.data, currentNBV: nbv };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const formData = await request.formData();
  const validation = await validator(fixedAssetDisposalValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { disposalDate } = validation.data;
  const disposalMethod = "Scrapping";

  const asset = await client
    .from("fixedAsset")
    .select("*, fixedAssetClass:fixedAssetClassId(*)")
    .eq("id", fixedAssetId)
    .single();

  if (asset.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(asset.error, "Failed to get asset"))
    );
  }

  const assetClass = asset.data.fixedAssetClass as any;
  const acquisitionCost = Number(asset.data.acquisitionCost);
  const accumulatedDepreciation = Number(asset.data.accumulatedDepreciation);
  const nbv = acquisitionCost - accumulatedDepreciation;

  const nextSequence = await getNextSequence(client, "journalEntry", companyId);
  if (nextSequence.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(nextSequence.error, "Failed to generate journal ID")
      )
    );
  }

  const now = new Date().toISOString();

  const journal = await client
    .from("journal")
    .insert({
      journalEntryId: nextSequence.data,
      companyId,
      description: `Asset Disposal: ${asset.data.fixedAssetId} (${disposalMethod})`,
      postingDate: disposalDate,
      sourceType: "Asset Disposal" as const,
      status: "Posted" as const,
      postedAt: now,
      postedBy: userId,
      createdBy: userId
    })
    .select("id")
    .single();

  if (journal.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(journal.error, "Failed to create disposal journal")
      )
    );
  }

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
      journalId: journal.data.id,
      accountId: assetClass.accumulatedDepreciationAccountId,
      description: "Clear accumulated depreciation",
      amount: toStoredAmount(accumulatedDepreciation, 0, "Asset"),
      journalLineReference: crypto.randomUUID(),
      companyId
    });
  }

  if (nbv > 0) {
    journalLines.push({
      journalId: journal.data.id,
      accountId: assetClass.writeOffAccountId,
      description: "Write-off remaining book value",
      amount: toStoredAmount(nbv, 0, "Expense"),
      journalLineReference: crypto.randomUUID(),
      companyId
    });
  }

  journalLines.push({
    journalId: journal.data.id,
    accountId: assetClass.assetAccountId,
    description: "Remove asset at cost",
    amount: toStoredAmount(0, acquisitionCost, "Asset"),
    journalLineReference: crypto.randomUUID(),
    companyId
  });

  if (journalLines.length > 0) {
    const lineResult = await client.from("journalLine").insert(journalLines);
    if (lineResult.error) {
      throw redirect(
        path.to.fixedAsset(fixedAssetId),
        await flash(
          request,
          error(lineResult.error, "Failed to create journal lines")
        )
      );
    }
  }

  await client.from("fixedAssetDisposal").insert({
    fixedAssetId,
    disposalMethod,
    disposalDate,
    saleProceeds: 0,
    netBookValueAtDisposal: nbv,
    gainLoss: -nbv,
    journalId: journal.data.id,
    companyId,
    createdBy: userId
  });

  await client
    .from("fixedAsset")
    .update({
      status: "Disposed",
      disposalDate,
      disposalMethod,
      saleProceeds: 0,
      updatedBy: userId
    })
    .eq("id", fixedAssetId);

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset disposed successfully"))
  );
}

export default function DisposeFixedAssetRoute() {
  const { currentNBV } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <FixedAssetDisposalForm
      currentNBV={currentNBV}
      onClose={() => navigate(-1)}
    />
  );
}
