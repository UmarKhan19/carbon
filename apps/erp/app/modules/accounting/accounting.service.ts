import type { Database, Json } from "@carbon/database";
import { getDateNYearsAgo } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  accountCategoryValidator,
  accountSubcategoryValidator,
  accountValidator,
  currencyValidator,
  defaultBalanceSheetAccountValidator,
  defaultIncomeAcountValidator,
  dimensionValidator,
  fiscalYearSettingsValidator,
  paymentTermValidator
} from "./accounting.models";
import type { Account, Transaction } from "./types";

type AccountWithTotals = Account & { level: number; totaling: string };

function addLevelsAndTotalsToAccounts(
  accounts: Account[]
): AccountWithTotals[] {
  let result: AccountWithTotals[] = [];
  let beginTotalAccounts: string[] = [];
  let endTotalAccounts: string[] = [];
  let hasHeading = false;

  accounts.forEach((account) => {
    if (["End Total", "Total"].includes(account.type)) {
      endTotalAccounts.push(account.number);
    }

    let level =
      beginTotalAccounts.length -
      endTotalAccounts.length +
      (hasHeading ? 1 : 0);

    if (account.type === "Begin Total") {
      beginTotalAccounts.push(account.number);
    }

    let totaling = "";

    if (["End Total", "Total"].includes(account.type)) {
      let startAccount = beginTotalAccounts.pop();
      let endAccount = endTotalAccounts.pop();

      totaling = `${startAccount}..${endAccount}`;
    }

    result.push({
      ...account,
      level,
      totaling
    });
  });

  return result;
}

export async function deleteAccount(
  client: SupabaseClient<Database>,
  accountId: string
) {
  return client.from("account").delete().eq("id", accountId);
}

export async function deleteAccountCategory(
  client: SupabaseClient<Database>,
  accountCategoryId: string
) {
  return client.from("accountCategory").delete().eq("id", accountCategoryId);
}

export async function deleteAccountSubcategory(
  client: SupabaseClient<Database>,
  accountSubcategoryId: string
) {
  return client
    .from("accountSubcategory")
    .update({ active: false })
    .eq("id", accountSubcategoryId);
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
    type?: Database["public"]["Enums"]["glAccountType"] | null;
    incomeBalance?: Database["public"]["Enums"]["glIncomeBalance"] | null;
    classes?: Database["public"]["Enums"]["glAccountClass"][];
  }
) {
  let query = client
    .from("account")
    .select("number, name, incomeBalance")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args?.type) {
    query = query.eq("type", args.type);
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

export async function getAccountCategories(
  client: SupabaseClient<Database>,
  companyGroupId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("accountCategories")
    .select("*", {
      count: "exact"
    })
    .eq("companyGroupId", companyGroupId);

  if (args.search) {
    query = query.ilike("category", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "incomeBalance", ascending: true },
    { column: "class", ascending: true },
    { column: "category", ascending: true }
  ]);
  return query;
}

export async function getAccountCategoriesList(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client
    .from("accountCategory")
    .select("*")
    .eq("companyGroupId", companyGroupId)
    .order("category", { ascending: true });
}

export async function getAccountCategory(
  client: SupabaseClient<Database>,
  accountCategoryId: string,
  companyGroupId: string
) {
  return client
    .from("accountCategory")
    .select("*")
    .eq("id", accountCategoryId)
    .eq("companyGroupId", companyGroupId)
    .single();
}

export async function getAccountSubcategories(
  client: SupabaseClient<Database>,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("accountSubcategory")
    .select("*", {
      count: "exact"
    })
    .eq("active", true);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getAccountSubcategoriesByCategory(
  client: SupabaseClient<Database>,
  accountCategoryId: string
) {
  return client
    .from("accountSubcategory")
    .select("*")
    .eq("accountCategoryId", accountCategoryId)
    .eq("active", true);
}

export async function getAccountSubcategory(
  client: SupabaseClient<Database>,
  accountSubcategoryId: string
) {
  return client
    .from("accountSubcategory")
    .select("*")
    .eq("id", accountSubcategoryId)
    .single();
}

function getAccountTotal(
  accounts: Account[],
  account: AccountWithTotals,
  type: "netChange" | "balance" | "balanceAtDate",
  transactionsByAccount: Record<string, Transaction>
) {
  if (!account.totaling) {
    return transactionsByAccount[account.number]?.[type] ?? 0;
  }

  let total = 0;
  const [start, end] = account.totaling.split("..");
  if (!start || !end) throw new Error("Invalid totaling");

  // for End Total -- we just do a simple sum of all accounts between start and end
  if (account.type === "End Total") {
    accounts.forEach((account) => {
      if (account.number >= start && account.number <= end) {
        total += transactionsByAccount[account.number]?.[type] ?? 0;
      }
    });
  }

  // for Total -- we use accounting equation to calculate the total
  if (account.type === "Total") {
    accounts.forEach((account) => {
      if (account.number >= start && account.number <= end) {
        if (["Asset", "Revenue"].includes(account.class as string)) {
          total += transactionsByAccount[account.number]?.[type] ?? 0;
        }
        if (
          ["Liability", "Equity", "Expense"].includes(account.class as string)
        ) {
          total -= transactionsByAccount[account.number]?.[type] ?? 0;
        }
      }
    });
  }

  return total;
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
  args: Omit<GenericQueryFilters, "limit" | "offset"> & {
    name: string | null;
    incomeBalance: "Income Statement" | "Balance Sheet" | null;
    startDate: string | null;
    endDate: string | null;
  }
) {
  let accountsQuery = client
    .from("accounts")
    .select("*")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  if (args.incomeBalance) {
    accountsQuery = accountsQuery.eq("incomeBalance", args.incomeBalance);
  }

  accountsQuery = setGenericQueryFilters(accountsQuery, args, [
    { column: "number", ascending: true }
  ]);

  let transactionsQuery = client.rpc("journalLinesByAccountNumber", {
    from_date:
      args.startDate ?? getDateNYearsAgo(50).toISOString().split("T")[0],
    to_date: args.endDate ?? new Date().toISOString().split("T")[0]
  });

  const [accountsResponse, transactionsResponse] = await Promise.all([
    accountsQuery,
    transactionsQuery
  ]);

  if (transactionsResponse.error) return transactionsResponse;
  if (accountsResponse.error) return accountsResponse;

  const transactionsByAccount = (
    transactionsResponse.data as unknown as Transaction[]
  ).reduce<Record<string, Transaction>>((acc, transaction: Transaction) => {
    acc[transaction.number] = transaction;
    return acc;
  }, {});

  // @ts-ignore
  const accounts: Account[] = accountsResponse.data as Account[];

  return {
    data: addLevelsAndTotalsToAccounts(accounts).map((account) => ({
      ...account,
      netChange: getAccountTotal(
        accounts,
        account,
        "netChange",
        transactionsByAccount
      ),

      balance: getAccountTotal(
        accounts,
        account,
        "balance",
        transactionsByAccount
      ),

      balanceAtDate: getAccountTotal(
        accounts,
        account,
        "balanceAtDate",
        transactionsByAccount
      )
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

export async function upsertAccountCategory(
  client: SupabaseClient<Database>,
  accountCategory:
    | (Omit<z.infer<typeof accountCategoryValidator>, "id"> & {
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof accountCategoryValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in accountCategory) {
    return client
      .from("accountCategory")
      .insert([accountCategory])
      .select("id")
      .single();
  }
  return client
    .from("accountCategory")
    .update(sanitize(accountCategory))
    .eq("id", accountCategory.id)
    .select("id")
    .single();
}

export async function upsertAccountSubcategory(
  client: SupabaseClient<Database>,
  accountSubcategory:
    | (Omit<z.infer<typeof accountSubcategoryValidator>, "id"> & {
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof accountSubcategoryValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in accountSubcategory) {
    return client
      .from("accountSubcategory")
      .insert([accountSubcategory])
      .select("id")
      .single();
  }
  return client
    .from("accountSubcategory")
    .update(sanitize(accountSubcategory))
    .eq("id", accountSubcategory.id)
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
