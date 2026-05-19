import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";

// -- Asset Classes --

export async function getFixedAssetClasses(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("fixedAssetClass")
    .select(
      "id, name, description, depreciationMethod, usefulLifeMonths, residualValuePercent, taxDepreciationMethod, taxUsefulLifeMonths, macrsPropertyClass",
      { count: "exact" }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getFixedAssetClass(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("fixedAssetClass").select("*").eq("id", id).single();
}

export async function getFixedAssetClassesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("fixedAssetClass")
    .select(
      "id, name, depreciationMethod, usefulLifeMonths, residualValuePercent"
    )
    .eq("companyId", companyId)
    .order("name");
}

export async function upsertFixedAssetClass(
  client: SupabaseClient<Database>,
  data:
    | (Record<string, any> & { companyId: string; createdBy: string })
    | (Record<string, any> & { id: string; updatedBy: string })
) {
  if ("createdBy" in data) {
    return client
      .from("fixedAssetClass")
      .insert([data as any])
      .select("id")
      .single();
  }
  const { id, ...rest } = data;
  return client
    .from("fixedAssetClass")
    .update(sanitize(rest))
    .eq("id", id)
    .select("id")
    .single();
}

export async function deleteFixedAssetClass(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("fixedAssetClass").delete().eq("id", id);
}

// -- Fixed Assets --

export async function getFixedAssets(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: Database["public"]["Enums"]["fixedAssetStatus"] | null;
  }
) {
  let query = client
    .from("fixedAsset")
    .select(
      "id, fixedAssetId, fixedAssetClassId, name, status, depreciationMethod, acquisitionCost, accumulatedDepreciation, fixedAssetClass:fixedAssetClassId(id, name), location:locationId(id, name)",
      { count: "exact" }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,fixedAssetId.ilike.%${args.search}%,serialNumber.ilike.%${args.search}%`
    );
  }

  if (args.status) {
    query = query.eq("status", args.status);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "fixedAssetId", ascending: true }
  ]);
  return query;
}

export async function getFixedAsset(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("fixedAsset")
    .select(
      "*, fixedAssetClass:fixedAssetClassId(*), location:locationId(id, name)"
    )
    .eq("id", id)
    .single();
}

export async function getFixedAssetsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("fixedAsset")
    .select("id, fixedAssetId, name")
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .order("fixedAssetId");
}

export async function getFixedAssetsListForSale(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("fixedAsset")
    .select("id, fixedAssetId, name")
    .eq("companyId", companyId)
    .in("status", ["Active", "Fully Depreciated"])
    .order("fixedAssetId");
}

export async function upsertFixedAsset(
  client: SupabaseClient<Database>,
  data:
    | (Record<string, any> & {
        fixedAssetId: string;
        companyId: string;
        createdBy: string;
      })
    | (Record<string, any> & { id: string; updatedBy: string })
) {
  if ("createdBy" in data) {
    return client
      .from("fixedAsset")
      .insert([data as any])
      .select("id")
      .single();
  }
  const { id, ...rest } = data;
  return client
    .from("fixedAsset")
    .update(sanitize(rest))
    .eq("id", id)
    .select("id")
    .single();
}

export async function deleteFixedAsset(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("fixedAsset").delete().eq("id", id).eq("status", "Draft");
}

// -- Depreciation Runs --

export async function getDepreciationRuns(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("depreciationRun")
    .select("id, depreciationRunId, periodEnd, status, postedAt", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("depreciationRunId", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "periodEnd", ascending: false }
  ]);
  return query;
}

export async function getDepreciationRun(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("depreciationRun").select("*").eq("id", id).single();
}

export async function getDepreciationRunLines(
  client: SupabaseClient<Database>,
  depreciationRunId: string
) {
  return client
    .from("depreciationRunLine")
    .select(
      "id, amount, taxAmount, journalId, fixedAsset:fixedAssetId(id, fixedAssetId, name, acquisitionCost, accumulatedDepreciation, accumulatedTaxDepreciation, residualValuePercent)"
    )
    .eq("depreciationRunId", depreciationRunId);
}

// -- Depreciation History for a single asset --

export async function getAssetDepreciationHistory(
  client: SupabaseClient<Database>,
  fixedAssetId: string
) {
  return client
    .from("depreciationRunLine")
    .select(
      "id, amount, taxAmount, journalId, depreciationRun:depreciationRunId(depreciationRunId, periodEnd, status)"
    )
    .eq("fixedAssetId", fixedAssetId)
    .order("depreciationRun(periodEnd)", { ascending: false });
}

// -- Disposals --

export async function getFixedAssetDisposal(
  client: SupabaseClient<Database>,
  fixedAssetId: string
) {
  return client
    .from("fixedAssetDisposal")
    .select("*")
    .eq("fixedAssetId", fixedAssetId)
    .maybeSingle();
}

// -- Usage Logs --

export async function getFixedAssetUsageLogs(
  client: SupabaseClient<Database>,
  fixedAssetId: string
) {
  return client
    .from("fixedAssetUsageLog")
    .select("*")
    .eq("fixedAssetId", fixedAssetId)
    .order("periodEnd", { ascending: false });
}

export async function upsertFixedAssetUsageLog(
  client: SupabaseClient<Database>,
  data: Record<string, any> & { companyId: string; createdBy: string }
) {
  return client
    .from("fixedAssetUsageLog")
    .insert([data as any])
    .select("id")
    .single();
}
