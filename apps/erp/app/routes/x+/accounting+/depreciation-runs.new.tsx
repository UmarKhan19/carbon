import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { DatePicker, Submit } from "~/components/Form";
import { depreciationRunValidator } from "~/modules/accounting";
import {
  calculateMacrsDepreciation,
  type MacrsConvention,
  type MacrsPropertyClass
} from "~/modules/accounting/macrs";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

function getMonthsBetween(start: Date, end: Date): number {
  const years = end.getFullYear() - start.getFullYear();
  const months = end.getMonth() - start.getMonth();
  let total = years * 12 + months;
  if (end.getDate() >= start.getDate()) total += 1;
  return Math.max(0, total);
}

function getMonthsElapsed(start: Date, end: Date): number {
  const years = end.getFullYear() - start.getFullYear();
  const months = end.getMonth() - start.getMonth();
  return Math.max(0, years * 12 + months);
}

function addOneMonth(dateStr: string): Date {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return d;
}

function calculateDepreciation(
  asset: {
    acquisitionCost: number;
    accumulatedDepreciation: number;
    residualValuePercent: number;
    depreciationMethod: string;
    usefulLifeMonths: number;
    depreciationStartDate: string | null;
    acquisitionDate: string | null;
    assetLifetimeUsage: number | null;
  },
  periodEnd: string,
  lastPostedPeriodEnd: string | null,
  usageLog?: { unitsProduced: number }
): number {
  const cost = Number(asset.acquisitionCost);
  const residualValue = cost * (Number(asset.residualValuePercent) / 100);
  const depreciableBase = cost - residualValue;
  const accumulated = Number(asset.accumulatedDepreciation);
  const remainingDepreciable = depreciableBase - accumulated;

  if (remainingDepreciable <= 0) return 0;

  const periodEndDate = new Date(periodEnd);
  const startDate = new Date(
    asset.depreciationStartDate ?? asset.acquisitionDate!
  );

  if (startDate > periodEndDate) return 0;

  switch (asset.depreciationMethod) {
    case "Straight Line": {
      const monthlyAmount = depreciableBase / asset.usefulLifeMonths;
      const from = lastPostedPeriodEnd
        ? addOneMonth(lastPostedPeriodEnd)
        : startDate;
      const monthsToDepreciate = getMonthsBetween(from, periodEndDate);
      const amount = monthlyAmount * monthsToDepreciate;
      return Math.min(Math.round(amount * 100) / 100, remainingDepreciable);
    }
    case "Declining Balance": {
      const annualRate = (1 / (asset.usefulLifeMonths / 12)) * 2;
      const monthlyRate = annualRate / 12;
      const from = lastPostedPeriodEnd
        ? addOneMonth(lastPostedPeriodEnd)
        : startDate;
      const monthsToDepreciate = getMonthsBetween(from, periodEndDate);
      let totalDepr = 0;
      let nbv = cost - accumulated;
      for (let i = 0; i < monthsToDepreciate; i++) {
        const dbAmount = nbv * monthlyRate;
        const remainingMonths = Math.max(
          1,
          asset.usefulLifeMonths -
            getMonthsElapsed(startDate, periodEndDate) +
            monthsToDepreciate -
            i
        );
        const slAmount = (nbv - residualValue) / remainingMonths;
        const amount = Math.max(dbAmount, slAmount);
        const capped = Math.min(amount, nbv - residualValue);
        if (capped <= 0) break;
        totalDepr += capped;
        nbv -= capped;
      }
      return Math.min(Math.round(totalDepr * 100) / 100, remainingDepreciable);
    }
    case "Units of Production": {
      if (
        !usageLog ||
        !asset.assetLifetimeUsage ||
        Number(asset.assetLifetimeUsage) <= 0
      )
        return 0;
      const ratePerUnit = depreciableBase / Number(asset.assetLifetimeUsage);
      const amount = ratePerUnit * usageLog.unitsProduced;
      return Math.min(Math.round(amount * 100) / 100, remainingDepreciable);
    }
    default:
      return 0;
  }
}

function calculateTaxDepreciation(
  asset: {
    acquisitionCost: number;
    accumulatedTaxDepreciation: number;
    depreciationStartDate: string | null;
    acquisitionDate: string | null;
    fixedAssetClass: {
      taxDepreciationMethod: string | null;
      taxUsefulLifeMonths: number | null;
      taxResidualValuePercent: number | null;
      macrsPropertyClass: string | null;
      macrsConvention: string | null;
      bonusDepreciationPercent: number | null;
    } | null;
  },
  periodEnd: string,
  lastPostedPeriodEnd: string | null
): number | null {
  const taxMethod = asset.fixedAssetClass?.taxDepreciationMethod;
  if (!taxMethod) return null;

  const cost = Number(asset.acquisitionCost);
  const accumulatedTax = Number(asset.accumulatedTaxDepreciation);
  const startDate = asset.depreciationStartDate ?? asset.acquisitionDate!;

  if (taxMethod === "MACRS") {
    const propertyClass = asset.fixedAssetClass!
      .macrsPropertyClass! as MacrsPropertyClass;
    const convention = (asset.fixedAssetClass!.macrsConvention ??
      "Half-Year") as MacrsConvention;
    const bonusPct = Number(
      asset.fixedAssetClass!.bonusDepreciationPercent ?? 0
    );
    const bonusAmount = cost * (bonusPct / 100);
    const adjustedBasis = cost - bonusAmount;

    let bonus = 0;
    if (accumulatedTax === 0 && bonusAmount > 0) {
      bonus = bonusAmount;
    }

    const macrsAmount = calculateMacrsDepreciation({
      adjustedBasis,
      propertyClass,
      convention,
      depreciationStartDate: startDate,
      periodEnd,
      lastPostedPeriodEnd,
      accumulatedTaxDepreciation: accumulatedTax,
      bonusAmount
    });

    return Math.round((bonus + macrsAmount) * 100) / 100;
  }

  const taxLife = asset.fixedAssetClass!.taxUsefulLifeMonths!;
  const taxResidualPct = Number(
    asset.fixedAssetClass!.taxResidualValuePercent ?? 0
  );
  const residualValue = cost * (taxResidualPct / 100);
  const depreciableBase = cost - residualValue;
  const remainingDepreciable = depreciableBase - accumulatedTax;

  if (remainingDepreciable <= 0) return 0;

  const periodEndDate = new Date(periodEnd);
  const depStartDate = new Date(startDate);

  if (depStartDate > periodEndDate) return 0;

  const from = lastPostedPeriodEnd
    ? addOneMonth(lastPostedPeriodEnd)
    : depStartDate;
  const monthsToDepreciate = getMonthsBetween(from, periodEndDate);

  if (taxMethod === "Straight Line") {
    const monthlyAmount = depreciableBase / taxLife;
    const amount = monthlyAmount * monthsToDepreciate;
    return Math.min(Math.round(amount * 100) / 100, remainingDepreciable);
  }

  if (taxMethod === "Declining Balance") {
    const annualRate = (1 / (taxLife / 12)) * 2;
    const monthlyRate = annualRate / 12;
    let totalDepr = 0;
    let nbv = cost - accumulatedTax;
    for (let i = 0; i < monthsToDepreciate; i++) {
      const dbAmount = nbv * monthlyRate;
      const remainingMonths = Math.max(
        1,
        taxLife -
          getMonthsElapsed(depStartDate, periodEndDate) +
          monthsToDepreciate -
          i
      );
      const slAmount = (nbv - residualValue) / remainingMonths;
      const amount = Math.max(dbAmount, slAmount);
      const capped = Math.min(amount, nbv - residualValue);
      if (capped <= 0) break;
      totalDepr += capped;
      nbv -= capped;
    }
    return Math.min(Math.round(totalDepr * 100) / 100, remainingDepreciable);
  }

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(depreciationRunValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { periodEnd } = validation.data;

  const existing = await client
    .from("depreciationRun")
    .select("id")
    .eq("periodEnd", periodEnd)
    .eq("companyId", companyId);

  if (existing.data && existing.data.length > 0) {
    return redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(null, "A depreciation run already exists for this period")
      )
    );
  }

  const companySettings = await client
    .from("companySettings")
    .select("assetTaxDepreciationEnabled")
    .eq("id", companyId)
    .single();

  const taxEnabled =
    (companySettings.data as any)?.assetTaxDepreciationEnabled ?? false;

  const assets = await client
    .from("fixedAsset")
    .select("*, fixedAssetClass:fixedAssetClassId(*)")
    .eq("companyId", companyId)
    .eq("status", "Active");

  if (assets.error) {
    return redirect(
      path.to.depreciationRuns,
      await flash(request, error(assets.error, "Failed to fetch assets"))
    );
  }

  const lastRun = await client
    .from("depreciationRun")
    .select("periodEnd")
    .eq("companyId", companyId)
    .eq("status", "Posted")
    .order("periodEnd", { ascending: false })
    .limit(1);

  const lastPostedPeriodEnd =
    lastRun.data && lastRun.data.length > 0 ? lastRun.data[0].periodEnd : null;

  const usageLogs = await client
    .from("fixedAssetUsageLog")
    .select("fixedAssetId, unitsProduced")
    .eq("periodEnd", periodEnd);

  const usageMap = new Map(
    (usageLogs.data ?? []).map((u) => [u.fixedAssetId, u])
  );

  const lines: {
    fixedAssetId: string;
    amount: number;
    taxAmount: number | null;
  }[] = [];

  for (const asset of assets.data ?? []) {
    const usageLog = usageMap.get(asset.id) as
      | { unitsProduced: number }
      | undefined;
    const amount = calculateDepreciation(
      {
        acquisitionCost: Number(asset.acquisitionCost),
        accumulatedDepreciation: Number(asset.accumulatedDepreciation),
        residualValuePercent: Number(asset.residualValuePercent),
        depreciationMethod: asset.depreciationMethod,
        usefulLifeMonths: asset.usefulLifeMonths,
        depreciationStartDate: asset.depreciationStartDate,
        acquisitionDate: asset.acquisitionDate,
        assetLifetimeUsage: asset.assetLifetimeUsage
          ? Number(asset.assetLifetimeUsage)
          : null
      },
      periodEnd,
      lastPostedPeriodEnd,
      usageLog
    );

    let taxAmount: number | null = null;
    if (taxEnabled) {
      taxAmount = calculateTaxDepreciation(
        {
          acquisitionCost: Number(asset.acquisitionCost),
          accumulatedTaxDepreciation: Number(
            (asset as any).accumulatedTaxDepreciation ?? 0
          ),
          depreciationStartDate: asset.depreciationStartDate,
          acquisitionDate: asset.acquisitionDate,
          fixedAssetClass: asset.fixedAssetClass as any
        },
        periodEnd,
        lastPostedPeriodEnd
      );
    }

    if (amount > 0 || (taxAmount !== null && taxAmount > 0)) {
      lines.push({ fixedAssetId: asset.id, amount, taxAmount });
    }
  }

  const nextSequence = await getNextSequence(
    client,
    "depreciationRun",
    companyId
  );
  if (nextSequence.error) {
    return redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(nextSequence.error, "Failed to generate run ID")
      )
    );
  }

  const run = await client
    .from("depreciationRun")
    .insert({
      depreciationRunId: nextSequence.data,
      periodEnd,
      status: "Draft",
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();

  if (run.error) {
    return redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(run.error, "Failed to create depreciation run")
      )
    );
  }

  if (lines.length > 0) {
    const lineInserts = lines.map((line) => ({
      depreciationRunId: run.data.id,
      fixedAssetId: line.fixedAssetId,
      amount: line.amount,
      taxAmount: line.taxAmount,
      companyId
    }));

    const lineResult = await client
      .from("depreciationRunLine")
      .insert(lineInserts);

    if (lineResult.error) {
      return redirect(
        path.to.depreciationRuns,
        await flash(
          request,
          error(lineResult.error, "Failed to create run lines")
        )
      );
    }
  }

  throw redirect(
    path.to.depreciationRun(run.data.id),
    await flash(request, success("Depreciation run created"))
  );
}

export default function NewDepreciationRunRoute() {
  const navigate = useNavigate();

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) navigate(-1);
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={depreciationRunValidator}
            method="post"
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>New Depreciation Run</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <DatePicker name="periodEnd" label="Period End Date" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit>Create Run</Submit>
                <Button size="md" variant="solid" onClick={() => navigate(-1)}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}
