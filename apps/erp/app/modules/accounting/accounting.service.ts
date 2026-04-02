import type { Database, Json } from "@carbon/database";
import { getDateNYearsAgo } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  accountValidator,
  costCenterValidator,
  currencyValidator,
  defaultBalanceSheetAccountValidator,
  defaultIncomeAcountValidator,
  dimensionValidator,
  fiscalYearSettingsValidator,
  intercompanyTransactionValidator,
  paymentTermValidator
} from "./accounting.models";
import type { Transaction, TranslatedBalance } from "./types";

export async function getTrialBalance(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string | null,
  args: {
    startDate: string | null;
    endDate: string | null;
  }
) {
  return client.rpc("trialBalance", {
    p_company_group_id: companyGroupId,
    p_company_id: companyId,
    from_date:
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0],
    to_date: args.endDate ?? new Date().toISOString().split("T")[0]
  });
}

export async function getFinancialStatementBalances(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string | null,
  args: {
    startDate: string | null;
    endDate: string | null;
  }
) {
  let accountsQuery = client
    .from("accounts")
    .select("*")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true)
    .order("number", { ascending: true });

  const balancesQuery = client.rpc("accountTreeBalancesByCompany", {
    p_company_group_id: companyGroupId,
    p_company_id: companyId,
    from_date:
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0],
    to_date: args.endDate ?? new Date().toISOString().split("T")[0]
  });

  const [accountsResponse, balancesResponse] = await Promise.all([
    accountsQuery,
    balancesQuery
  ]);

  if (accountsResponse.error) return accountsResponse;
  if (balancesResponse.error) return balancesResponse;

  const balancesByAccountId = (
    balancesResponse.data as unknown as (Transaction & { accountId: string })[]
  ).reduce<Record<string, Transaction>>((acc, row) => {
    acc[row.accountId] = {
      number: row.number,
      netChange: row.netChange,
      balance: row.balance,
      balanceAtDate: row.balanceAtDate
    };
    return acc;
  }, {});

  return {
    data: (accountsResponse.data ?? []).map((account) => ({
      ...account,
      netChange: balancesByAccountId[account.id]?.netChange ?? 0,
      balance: balancesByAccountId[account.id]?.balance ?? 0,
      balanceAtDate: balancesByAccountId[account.id]?.balanceAtDate ?? 0
    })),
    error: null
  };
}

export async function getCompaniesInGroup(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client
    .from("company")
    .select("id, name, baseCurrencyCode, parentCompanyId, isEliminationEntity")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true)
    .eq("isEliminationEntity", false)
    .order("name", { ascending: true });
}

export async function deleteAccount(
  client: SupabaseClient<Database>,
  accountId: string
) {
  return client.from("account").delete().eq("id", accountId);
}

export async function deletePaymentTerm(
  client: SupabaseClient<Database>,
  paymentTermId: string
) {
  return client
    .from("paymentTerm")
    .update({ active: false })
    .eq("id", paymentTermId);
}

export async function getAccount(
  client: SupabaseClient<Database>,
  accountId: string
) {
  return client.from("account").select("*").eq("id", accountId).single();
}

export async function getAccounts(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("account")
    .select("*", {
      count: "exact"
    })
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getAccountsList(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args?: {
    isGroup?: boolean | null;
    incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"] | null;
    classes?: Database["public"]["Enums"]["glAccountClass"][];
  }
) {
  let query = client
    .from("account")
    .select("number, name, incomeBalance")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args?.isGroup !== undefined && args.isGroup !== null) {
    query = query.eq("isGroup", args.isGroup);
  }

  if (args?.incomeBalance) {
    query = query.eq("incomeBalance", args.incomeBalance);
  }

  if (args?.classes && args.classes.length > 0) {
    query = query.in("class", args.classes);
  }

  query = query.order("number", { ascending: true });
  return query;
}

export async function getGroupAccounts(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client
    .from("account")
    .select("id, number, name, incomeBalance, class, accountType")
    .eq("companyGroupId", companyGroupId)
    .eq("isGroup", true)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function getBaseCurrency(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const { data: company, error } = await client
    .from("company")
    .select("baseCurrencyCode, companyGroupId")
    .eq("id", companyId)
    .single();

  if (error) {
    throw new Error(`Failed to get company: ${error.message}`);
  }

  if (!company || !company.baseCurrencyCode) {
    throw new Error("Company or base currency code not found");
  }

  return client
    .from("currency")
    .select("*")
    .eq("code", company.baseCurrencyCode)
    .eq("companyGroupId", company.companyGroupId!)
    .single();
}

export async function getChartOfAccounts(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: {
    incomeBalance: "Income Statement" | "Balance Sheet" | null;
    startDate: string | null;
    endDate: string | null;
  }
) {
  let accountsQuery = client
    .from("accounts")
    .select("*")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true)
    .order("number", { ascending: true });

  if (args.incomeBalance) {
    accountsQuery = accountsQuery.eq("incomeBalance", args.incomeBalance);
  }

  const balancesQuery = client.rpc("accountTreeBalances", {
    p_company_group_id: companyGroupId,
    from_date:
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0],
    to_date: args.endDate ?? new Date().toISOString().split("T")[0]
  });

  const [accountsResponse, balancesResponse] = await Promise.all([
    accountsQuery,
    balancesQuery
  ]);

  if (accountsResponse.error) return accountsResponse;
  if (balancesResponse.error) return balancesResponse;

  const balancesByAccountId = (
    balancesResponse.data as unknown as (Transaction & { accountId: string })[]
  ).reduce<Record<string, Transaction>>((acc, row) => {
    acc[row.accountId] = {
      number: row.number,
      netChange: row.netChange,
      balance: row.balance,
      balanceAtDate: row.balanceAtDate
    };
    return acc;
  }, {});

  return {
    data: (accountsResponse.data ?? []).map((account) => ({
      ...account,
      netChange: balancesByAccountId[account.id]?.netChange ?? 0,
      balance: balancesByAccountId[account.id]?.balance ?? 0,
      balanceAtDate: balancesByAccountId[account.id]?.balanceAtDate ?? 0
    })),
    error: null
  };
}

export async function getCurrency(
  client: SupabaseClient<Database>,
  currencyId: string
) {
  return client.from("currencies").select("*").eq("id", currencyId).single();
}

export async function getCurrencyByCode(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  currencyCode: string
) {
  return client
    .from("currencies")
    .select("*")
    .eq("code", currencyCode)
    .eq("companyGroupId", companyGroupId)
    .single();
}

export async function getCurrencies(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("currencies")
    .select("*", {
      count: "exact"
    })
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  return query;
}

export async function getCurrenciesList(client: SupabaseClient<Database>) {
  return client
    .from("currencyCode")
    .select("code, name")
    .order("name", { ascending: true });
}

export async function getCurrentAccountingPeriod(
  client: SupabaseClient<Database>,
  companyId: string,
  date: string
) {
  return client
    .from("accountingPeriod")
    .select("*")
    .eq("companyId", companyId)
    .lte("startDate", date)
    .gte("endDate", date)
    .single();
}

export async function getDefaultAccounts(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("accountDefault")
    .select("*")
    .eq("companyId", companyId)
    .single();
}

export async function getFiscalYearSettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("fiscalYearSettings")
    .select("*")
    .eq("companyId", companyId)
    .single();
}

export async function getPaymentTerm(
  client: SupabaseClient<Database>,
  paymentTermId: string
) {
  return client
    .from("paymentTerm")
    .select("*")
    .eq("id", paymentTermId)
    .single();
}

export async function getPaymentTerms(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("paymentTerm")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getPaymentTermsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("paymentTerm")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function updateDefaultBalanceSheetAccounts(
  client: SupabaseClient<Database>,
  defaultAccounts: z.infer<typeof defaultBalanceSheetAccountValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("accountDefault")
    .update(defaultAccounts)
    .eq("companyId", defaultAccounts.companyId);
}

export async function updateDefaultIncomeAccounts(
  client: SupabaseClient<Database>,
  defaultAccounts: z.infer<typeof defaultIncomeAcountValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("accountDefault")
    .update(defaultAccounts)
    .eq("companyId", defaultAccounts.companyId);
}

export async function updateFiscalYearSettings(
  client: SupabaseClient<Database>,
  fiscalYearSettings: z.infer<typeof fiscalYearSettingsValidator> & {
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("fiscalYearSettings")
    .update(sanitize(fiscalYearSettings))
    .eq("companyId", fiscalYearSettings.companyId);
}

export async function upsertAccount(
  client: SupabaseClient<Database>,
  account:
    | (Omit<z.infer<typeof accountValidator>, "id"> & {
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof accountValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in account) {
    return client.from("account").insert([account]).select("*").single();
  }
  return client
    .from("account")
    .update(sanitize(account))
    .eq("id", account.id)
    .select("id")
    .single();
}

export async function upsertCurrency(
  client: SupabaseClient<Database>,
  currency:
    | (Omit<z.infer<typeof currencyValidator>, "id"> & {
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof currencyValidator>, "id"> & {
        id: string;
        companyGroupId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in currency) {
    return client.from("currency").insert([currency]).select("*").single();
  }
  return client
    .from("currency")
    .update(sanitize(currency))
    .eq("id", currency.id)
    .select("id")
    .single();
}

export async function upsertPaymentTerm(
  client: SupabaseClient<Database>,
  paymentTerm:
    | (Omit<z.infer<typeof paymentTermValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof paymentTermValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in paymentTerm) {
    return client
      .from("paymentTerm")
      .insert([paymentTerm])
      .select("id")
      .single();
  }
  return client
    .from("paymentTerm")
    .update(sanitize(paymentTerm))
    .eq("id", paymentTerm.id)
    .select("id")
    .single();
}

export async function deleteCostCenter(
  client: SupabaseClient<Database>,
  costCenterId: string
) {
  return client.from("costCenter").delete().eq("id", costCenterId);
}

export async function getCostCenter(
  client: SupabaseClient<Database>,
  costCenterId: string
) {
  return client.from("costCenter").select("*").eq("id", costCenterId).single();
}

export async function getCostCenters(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("costCenter")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getCostCentersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("costCenter")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getCostCentersTree(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("costCenter")
    .select("id, name, parentCostCenterId")
    .eq("companyId", companyId)
    .order("name");
}

export async function upsertCostCenter(
  client: SupabaseClient<Database>,
  costCenter:
    | (Omit<z.infer<typeof costCenterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof costCenterValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in costCenter) {
    return client.from("costCenter").insert([costCenter]).select("id").single();
  }
  return client
    .from("costCenter")
    .update(sanitize(costCenter))
    .eq("id", costCenter.id)
    .select("id")
    .single();
}

export async function getDimensions(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("dimension")
    .select("*, dimensionValue(id, name)", {
      count: "exact"
    })
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getDimension(
  client: SupabaseClient<Database>,
  dimensionId: string
) {
  return client
    .from("dimension")
    .select("*, dimensionValue(id, name)")
    .eq("id", dimensionId)
    .single();
}

export async function upsertDimension(
  client: SupabaseClient<Database>,
  dimension:
    | (Omit<z.infer<typeof dimensionValidator>, "id" | "dimensionValues"> & {
        companyGroupId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof dimensionValidator>, "id" | "dimensionValues"> & {
        id: string;
        updatedBy: string;
      }),
  dimensionValues?: string[]
) {
  let dimensionResult;

  if ("createdBy" in dimension) {
    dimensionResult = await client
      .from("dimension")
      .insert([dimension])
      .select("id, companyGroupId")
      .single();
  } else {
    dimensionResult = await client
      .from("dimension")
      .update(sanitize(dimension))
      .eq("id", dimension.id)
      .select("id, companyGroupId")
      .single();
  }

  if (dimensionResult.error) return dimensionResult;

  if (dimension.entityType === "Custom" && dimensionValues !== undefined) {
    const dimensionId = dimensionResult.data.id;
    const companyGroupId = dimensionResult.data.companyGroupId;

    const existing = await client
      .from("dimensionValue")
      .select("id, name")
      .eq("dimensionId", dimensionId);

    if (existing.error) return existing;

    const existingNames = new Set((existing.data ?? []).map((v) => v.name));
    const desiredNames = new Set(dimensionValues);

    const toDelete = (existing.data ?? [])
      .filter((v) => !desiredNames.has(v.name))
      .map((v) => v.id);

    if (toDelete.length > 0) {
      const deleteResult = await client
        .from("dimensionValue")
        .delete()
        .in("id", toDelete);
      if (deleteResult.error) return deleteResult;
    }

    const toInsert = dimensionValues
      .filter((name) => !existingNames.has(name))
      .map((name) => ({
        dimensionId,
        name,
        companyGroupId,
        createdBy:
          "createdBy" in dimension ? dimension.createdBy : dimension.updatedBy
      }));

    if (toInsert.length > 0) {
      const insertResult = await client.from("dimensionValue").insert(toInsert);
      if (insertResult.error) return insertResult;
    }
  }

  return dimensionResult;
}

export async function deleteDimension(
  client: SupabaseClient<Database>,
  dimensionId: string
) {
  return client
    .from("dimension")
    .update({ active: false })
    .eq("id", dimensionId);
}

export async function translateCompanyBalances(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyId: string,
  targetCurrency: string,
  periodEnd: string,
  periodStart?: string
): Promise<{
  data: TranslatedBalance[] | null;
  cta: number;
  error: string | null;
}> {
  const { data, error } = await client.rpc("translateTrialBalance", {
    p_company_group_id: companyGroupId,
    p_company_id: companyId,
    p_target_currency: targetCurrency,
    p_period_end: periodEnd,
    p_period_start: periodStart ?? null
  });

  if (error) {
    return { data: null, cta: 0, error: error.message };
  }

  const rows = (data ?? []) as unknown as TranslatedBalance[];

  // Look up each account's class to compute CTA
  const accountIds = rows.map((r) => r.accountId);
  const { data: accounts } = await client
    .from("account")
    .select("id, class")
    .in("id", accountIds);

  const classById = new Map((accounts ?? []).map((a) => [a.id, a.class]));

  let totalTranslatedAssets = 0;
  let totalTranslatedLiabilitiesAndEquity = 0;

  for (const row of rows) {
    const cls = classById.get(row.accountId);
    if (cls === "Asset") {
      totalTranslatedAssets += Number(row.translatedBalance);
    } else {
      // Liability, Equity, Revenue, Expense (but income statement
      // accounts net to retained earnings on balance sheet)
      totalTranslatedLiabilitiesAndEquity += Number(row.translatedBalance);
    }
  }

  // CTA = translated assets - translated (liabilities + equity)
  // A balanced sheet means assets = liabilities + equity + CTA
  const cta = totalTranslatedAssets - totalTranslatedLiabilitiesAndEquity;

  return { data: rows, cta, error: null };
}

export async function getConsolidatedBalances(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  companyIds: string[],
  targetCurrency: string,
  periodEnd: string,
  periodStart?: string
) {
  // Find elimination entities that should be included automatically.
  // An elimination entity is included when its parentCompanyId is an ancestor
  // of any selected company (i.e. it sits at or above the selected companies
  // in the hierarchy and captures their intercompany eliminations).
  const { data: allGroupCompanies } = await client
    .from("company")
    .select("id, parentCompanyId, isEliminationEntity")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  const groupCompanies = allGroupCompanies ?? [];
  const selectedSet = new Set(companyIds);

  // Collect all ancestors of selected companies
  const ancestors = new Set<string>();
  const companyById = new Map(groupCompanies.map((c) => [c.id, c]));
  for (const id of companyIds) {
    let current = companyById.get(id);
    while (current?.parentCompanyId) {
      ancestors.add(current.parentCompanyId);
      current = companyById.get(current.parentCompanyId);
    }
  }

  // Include elimination entities whose parent is an ancestor of (or is) a
  // selected company — these hold the reversing entries for IC transactions
  const eliminationIds = groupCompanies
    .filter(
      (c) =>
        c.isEliminationEntity &&
        c.parentCompanyId &&
        (ancestors.has(c.parentCompanyId) || selectedSet.has(c.parentCompanyId))
    )
    .map((c) => c.id);

  // All companies whose balances we need (operating + elimination entities)
  const allIds = [...companyIds, ...eliminationIds];

  // Get balances for all companies and translate to target currency
  const [allBalances, translations] = await Promise.all([
    Promise.all(
      allIds.map((id) =>
        getFinancialStatementBalances(client, companyGroupId, id, {
          startDate: periodStart ?? null,
          endDate: periodEnd
        })
      )
    ),
    Promise.all(
      allIds.map((id) =>
        translateCompanyBalances(
          client,
          companyGroupId,
          id,
          targetCurrency,
          periodEnd,
          periodStart
        )
      )
    )
  ]);

  // Build a map of translated balances per account, summed across companies
  const translationByAccount = new Map<
    string,
    { translatedBalance: number; exchangeRate: number }
  >();

  for (const translation of translations) {
    if (!translation.data) continue;
    for (const row of translation.data) {
      const existing = translationByAccount.get(row.accountId);
      if (existing) {
        existing.translatedBalance += Number(row.translatedBalance);
      } else {
        translationByAccount.set(row.accountId, {
          translatedBalance: Number(row.translatedBalance),
          exchangeRate: Number(row.exchangeRate)
        });
      }
    }
  }

  // Sum CTA across all companies
  const totalCta = translations.reduce((sum, t) => sum + t.cta, 0);

  // Merge all company balances into one set of accounts, summing balances
  const accountMap = new Map<
    string,
    {
      balance: number;
      balanceAtDate: number;
      netChange: number;
      translatedBalance: number;
      exchangeRate: number;
    }
  >();

  for (const result of allBalances) {
    if (result.error || !result.data) continue;
    for (const account of result.data) {
      const existing = accountMap.get(account.id);
      if (existing) {
        existing.balance += account.balance ?? 0;
        existing.balanceAtDate += account.balanceAtDate ?? 0;
        existing.netChange += account.netChange ?? 0;
      } else {
        accountMap.set(account.id, {
          balance: account.balance ?? 0,
          balanceAtDate: account.balanceAtDate ?? 0,
          netChange: account.netChange ?? 0,
          translatedBalance: 0,
          exchangeRate: 0
        });
      }
    }
  }

  // Overlay translated values
  for (const [accountId, translation] of translationByAccount) {
    const account = accountMap.get(accountId);
    if (account) {
      account.translatedBalance = translation.translatedBalance;
      account.exchangeRate = translation.exchangeRate;
    }
  }

  // Use the first company's account structure as the base (shared chart of accounts)
  const baseAccounts = allBalances.find((r) => r.data)?.data ?? [];

  const consolidated = baseAccounts.map((account) => {
    const summed = accountMap.get(account.id);
    return {
      ...account,
      balance: summed?.balance ?? 0,
      balanceAtDate: summed?.balanceAtDate ?? 0,
      netChange: summed?.netChange ?? 0,
      translatedBalance: summed?.translatedBalance ?? 0,
      exchangeRate: summed?.exchangeRate ?? 0
    };
  });

  return { data: consolidated, cta: totalCta };
}

// -- Intercompany --

export async function getIntercompanyTransactions(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: GenericQueryFilters & { status: string | null }
) {
  let query = client
    .from("intercompanyTransaction")
    .select(
      "*, sourceCompany:company!intercompanyTransaction_sourceCompanyId_fkey(name), targetCompany:company!intercompanyTransaction_targetCompanyId_fkey(name)",
      { count: "exact" }
    )
    .eq("companyGroupId", companyGroupId);

  if (args.status) {
    query = query.eq("status", args.status);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

export async function createIntercompanyTransaction(
  client: SupabaseClient<Database>,
  input: z.infer<typeof intercompanyTransactionValidator> & {
    companyGroupId: string;
    userId: string;
  }
) {
  const today = new Date().toISOString().split("T")[0];
  const postingDate = input.postingDate || today;

  // Create the journal entry on the source company
  const journal = await client
    .from("journal")
    .insert({
      description: `IC: ${input.description}`,
      companyId: input.sourceCompanyId,
      postingDate
    })
    .select("id")
    .single();

  if (journal.error) return journal;

  const journalId = journal.data.id;
  const journalLineRef = crypto.randomUUID();

  // Insert debit and credit journal lines
  const journalLines = await client
    .from("journalLine")
    .insert([
      {
        journalId,
        accountNumber: input.debitAccountNumber,
        description: input.description,
        amount: input.amount,
        journalLineReference: journalLineRef,
        intercompanyPartnerId: input.targetCompanyId,
        companyId: input.sourceCompanyId,
        companyGroupId: input.companyGroupId
      },
      {
        journalId,
        accountNumber: input.creditAccountNumber,
        description: input.description,
        amount: -input.amount,
        journalLineReference: journalLineRef,
        intercompanyPartnerId: input.targetCompanyId,
        companyId: input.sourceCompanyId,
        companyGroupId: input.companyGroupId
      }
    ])
    .select("id");

  if (journalLines.error) return journalLines;

  // Create intercompany transaction record
  return client
    .from("intercompanyTransaction")
    .insert({
      companyGroupId: input.companyGroupId,
      sourceCompanyId: input.sourceCompanyId,
      targetCompanyId: input.targetCompanyId,
      sourceJournalLineId: journalLines.data[0].id,
      amount: input.amount,
      currencyCode: input.currencyCode,
      description: input.description,
      status: "Unmatched"
    })
    .select("id")
    .single();
}

export async function runIntercompanyMatching(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client.rpc("matchIntercompanyTransactions", {
    p_company_group_id: companyGroupId
  });
}

export async function generateEliminations(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  userId: string
) {
  return client.rpc("generateEliminationEntries", {
    p_company_group_id: companyGroupId,
    p_user_id: userId
  });
}

export async function getIntercompanyBalance(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client.rpc("getIntercompanyBalance", {
    p_company_group_id: companyGroupId
  });
}

export async function getExchangeRateHistory(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  currencyCode: string
) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  return client
    .from("exchangeRateHistory")
    .select("effectiveDate, rate")
    .eq("companyGroupId", companyGroupId)
    .eq("currencyCode", currencyCode)
    .gte("effectiveDate", sixMonthsAgo.toISOString().split("T")[0])
    .order("effectiveDate", { ascending: true });
}
