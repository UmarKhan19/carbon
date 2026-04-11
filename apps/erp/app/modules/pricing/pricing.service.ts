import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { lookupPriceFromBreaks } from "~/modules/shared";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  priceListAssignmentValidator,
  priceListItemValidator,
  priceListRuleValidator,
  priceListValidator
} from "./pricing.models";

export async function getPriceListsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("priceList")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("type", "Sales")
    .in("status", ["Active", "Draft"])
    .order("name");
}

export async function getPriceLists(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & {
    search?: string;
    customerId?: string;
  }
) {
  let priceListIds: string[] | null = null;

  if (args?.customerId) {
    let assignmentQuery = client
      .from("priceListAssignment")
      .select("priceListId")
      .eq("companyId", companyId);

    assignmentQuery = assignmentQuery.eq("customerId", args.customerId);

    const { data: assignments } = await assignmentQuery;
    priceListIds = (assignments ?? []).map((a) => a.priceListId);

    const { data: allLists } = await client
      .from("priceList")
      .select("id")
      .eq("companyId", companyId)
      .eq("type", "Sales");

    if (allLists) {
      const { data: allAssignments } = await client
        .from("priceListAssignment")
        .select("priceListId")
        .eq("companyId", companyId);

      const assignedListIds = new Set(
        (allAssignments ?? []).map((a) => a.priceListId)
      );
      const globalListIds = allLists
        .filter((l) => !assignedListIds.has(l.id))
        .map((l) => l.id);

      priceListIds = [...new Set([...priceListIds, ...globalListIds])];
    }
  }

  let query = client
    .from("priceList")
    .select("*, priceListAssignment(count)", { count: "exact" })
    .eq("companyId", companyId)
    .eq("type", "Sales");

  if (priceListIds !== null) {
    query = query.in("id", priceListIds);
  }

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    const cleanedArgs = {
      ...args,
      filters: args.filters?.filter((f) => f.column !== "customerId")
    };
    query = setGenericQueryFilters(query, cleanedArgs);
  }

  return query;
}

export async function getPriceList(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("priceList").select("*").eq("id", id).single();
}

/**
 * Returns the type AND a flag indicating whether the price list is
 * locked for edits (status === "Active"). Active price lists are
 * immutable to satisfy AC-ERP-08: every modification must produce a
 * new version. Mutation routes call this and reject the request if
 * `isLocked` is true.
 */
export async function getPriceListLockState(
  client: SupabaseClient<Database>,
  priceListId: string
): Promise<{ isLocked: boolean }> {
  const { data } = await client
    .from("priceList")
    .select("status")
    .eq("id", priceListId)
    .single();
  return { isLocked: data?.status === "Active" };
}

export async function createPriceList(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  data: z.infer<typeof priceListValidator>
) {
  return client
    .from("priceList")
    .insert([
      {
        name: data.name,
        description: data.description ?? null,
        type: "Sales",
        status: data.status ?? "Draft",
        priceType: data.priceType ?? "Net",
        currencyCode: data.currencyCode,
        validFrom: data.validFrom ?? null,
        validTo: data.validTo ?? null,
        sequence: 0,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();
}

export async function updatePriceList(
  client: SupabaseClient<Database>,
  id: string,
  userId: string,
  data: Partial<z.infer<typeof priceListValidator>>
) {
  return client
    .from("priceList")
    .update(
      sanitize({
        ...data,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", id)
    .select("id")
    .single();
}

export async function deletePriceList(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("priceList").delete().eq("id", id);
}

export async function getPriceListItems(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  return client
    .from("priceListItem")
    .select(
      "*, item(id, readableId, name, itemCost(unitCost)), itemPostingGroup(id, name), priceListItemBreak(*)"
    )
    .eq("priceListId", priceListId)
    .order("createdAt", { ascending: true });
}

export async function getPriceListItem(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("priceListItem")
    .select("*, item(id, readableId, name), itemPostingGroup(id, name)")
    .eq("id", id)
    .single();
}

export async function createPriceListItem(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  data: z.infer<typeof priceListItemValidator>
) {
  return client
    .from("priceListItem")
    .insert([
      {
        priceListId: data.priceListId,
        itemId: data.itemId ?? null,
        itemPostingGroupId: data.itemPostingGroupId ?? null,
        unitPrice: data.unitPrice,
        unitOfMeasureCode: data.unitOfMeasureCode ?? null,
        pricingMethod: data.pricingMethod ?? "Fixed",
        formulaBase: data.formulaBase ?? null,
        markupPercent: data.markupPercent ?? null,
        minMarginPercent: data.minMarginPercent ?? null,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();
}

export async function updatePriceListItem(
  client: SupabaseClient<Database>,
  id: string,
  userId: string,
  data: Partial<z.infer<typeof priceListItemValidator>>
) {
  return client
    .from("priceListItem")
    .update(
      sanitize({
        ...data,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", id)
    .select("id")
    .single();
}

export async function deletePriceListItem(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("priceListItem").delete().eq("id", id);
}

export async function getPriceListItemBreaks(
  client: SupabaseClient<Database>,
  priceListItemId: string
) {
  return client
    .from("priceListItemBreak")
    .select("*")
    .eq("priceListItemId", priceListItemId)
    .order("minQuantity", { ascending: true });
}

export async function upsertPriceListItemBreaks(
  db: Kysely<KyselyDatabase>,
  priceListItemId: string,
  companyId: string,
  userId: string,
  breaks: Array<{ minQuantity: number; unitPrice: number }>
) {
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("priceListItemBreak")
      .where("priceListItemId", "=", priceListItemId)
      .execute();

    if (breaks.length === 0) return;

    await trx
      .insertInto("priceListItemBreak")
      .values(
        breaks.map((b) => ({
          priceListItemId,
          minQuantity: b.minQuantity,
          unitPrice: b.unitPrice,
          companyId,
          createdBy: userId
        }))
      )
      .execute();
  });
}

export async function getPriceListRules(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  return client
    .from("priceListRule")
    .select("*")
    .eq("priceListId", priceListId)
    .order("priority", { ascending: false });
}

export async function getPriceListRule(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("priceListRule").select("*").eq("id", id).single();
}

export async function createPriceListRule(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  data: z.infer<typeof priceListRuleValidator>
) {
  return client
    .from("priceListRule")
    .insert([
      {
        priceListId: data.priceListId,
        name: data.name,
        ruleType: data.ruleType,
        amountType: data.amountType,
        amount: data.amount,
        minQuantity: data.minQuantity ?? null,
        maxQuantity: data.maxQuantity ?? null,
        customerTypeId: data.customerTypeId ?? null,
        itemId: data.itemId ?? null,
        itemPostingGroupId: data.itemPostingGroupId ?? null,
        validFrom: data.validFrom || null,
        validTo: data.validTo || null,
        active: data.active ?? true,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();
}

export async function updatePriceListRule(
  client: SupabaseClient<Database>,
  id: string,
  userId: string,
  data: Partial<z.infer<typeof priceListRuleValidator>>
) {
  return client
    .from("priceListRule")
    .update(
      sanitize({
        ...data,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", id)
    .select("id")
    .single();
}

export async function deletePriceListRule(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("priceListRule").delete().eq("id", id);
}

export async function getPriceListAssignments(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  return client
    .from("priceListAssignment")
    .select("*, customer(id, name), customerType(id, name)")
    .eq("priceListId", priceListId)
    .order("createdAt", { ascending: true });
}

export async function createPriceListAssignment(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  data: z.infer<typeof priceListAssignmentValidator>
) {
  return client
    .from("priceListAssignment")
    .insert([
      {
        priceListId: data.priceListId,
        customerId: data.customerId ?? null,
        customerTypeId: data.customerTypeId ?? null,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();
}

export async function deletePriceListAssignment(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("priceListAssignment").delete().eq("id", id);
}

export async function syncPriceListAssignments(
  db: Kysely<KyselyDatabase>,
  priceListId: string,
  companyId: string,
  userId: string,
  assignments: {
    customerIds?: string[];
    customerTypeIds?: string[];
  }
): Promise<{ error: { message: string } | null }> {
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("priceListAssignment")
        .where("priceListId", "=", priceListId)
        .execute();

      const rows: Array<{
        priceListId: string;
        customerId: string | null;
        customerTypeId: string | null;
        companyId: string;
        createdBy: string;
      }> = [];

      for (const id of assignments.customerIds ?? []) {
        rows.push({
          priceListId,
          customerId: id,
          customerTypeId: null,
          companyId,
          createdBy: userId
        });
      }
      for (const id of assignments.customerTypeIds ?? []) {
        rows.push({
          priceListId,
          customerId: null,
          customerTypeId: id,
          companyId,
          createdBy: userId
        });
      }

      if (rows.length === 0) return;

      await trx.insertInto("priceListAssignment").values(rows).execute();
    });
    return { error: null };
  } catch (err) {
    return {
      error: {
        message:
          err instanceof Error ? err.message : "Failed to sync assignments"
      }
    };
  }
}

export async function createPriceListVersion(
  client: SupabaseClient<Database>,
  priceListId: string,
  companyId: string,
  userId: string
) {
  // 1. Get current price list
  const { data: current, error: fetchError } = await getPriceList(
    client,
    priceListId
  );
  if (fetchError || !current) return { data: null, error: fetchError };

  // 2. Archive the current version
  await client
    .from("priceList")
    .update({
      status: "Archived" as const,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", priceListId);

  // 3. Create new version (no parentId — uses name + version grouping)
  const { data: newList, error: createError } = await client
    .from("priceList")
    .insert([
      {
        name: current.name,
        description: current.description,
        type: current.type,
        status: "Draft" as const,
        priceType: current.priceType,
        currencyCode: current.currencyCode,
        validFrom: current.validFrom,
        validTo: current.validTo,
        sequence: current.sequence,
        version: current.version + 1,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();

  if (createError || !newList) return { data: null, error: createError };

  // 4. Copy children (items, breaks, rules, assignments)
  await copyPriceListChildren(
    client,
    priceListId,
    newList.id,
    companyId,
    userId
  );

  return { data: newList, error: null };
}

/**
 * Archive all Active sibling versions of a price list (same name + companyId,
 * different ID). Called when a version is activated to enforce the invariant:
 * at most one version is Active at a time. Draft siblings are left untouched
 * because they don't participate in price resolution and archiving in-progress
 * work would be surprising.
 */
export async function archiveSiblingVersions(
  client: SupabaseClient<Database>,
  priceListId: string,
  companyId: string,
  userId: string
) {
  const { data: self } = await client
    .from("priceList")
    .select("name")
    .eq("id", priceListId)
    .single();
  if (!self) return;

  return client
    .from("priceList")
    .update({
      status: "Archived" as const,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("name", self.name)
    .eq("companyId", companyId)
    .eq("status", "Active")
    .neq("id", priceListId);
}

async function copyPriceListChildren(
  client: SupabaseClient<Database>,
  sourceListId: string,
  targetListId: string,
  companyId: string,
  userId: string
) {
  // Items + breaks
  const { data: items } = await client
    .from("priceListItem")
    .select("*")
    .eq("priceListId", sourceListId);

  if (items && items.length > 0) {
    for (const item of items) {
      const { data: newItem } = await client
        .from("priceListItem")
        .insert([
          {
            priceListId: targetListId,
            itemId: item.itemId,
            itemPostingGroupId: item.itemPostingGroupId,
            unitPrice: item.unitPrice,
            unitOfMeasureCode: item.unitOfMeasureCode,
            pricingMethod: item.pricingMethod,
            formulaBase: item.formulaBase,
            markupPercent: item.markupPercent,
            minMarginPercent: item.minMarginPercent,
            companyId,
            createdBy: userId
          }
        ])
        .select("id")
        .single();

      if (newItem) {
        const { data: breaks } = await client
          .from("priceListItemBreak")
          .select("*")
          .eq("priceListItemId", item.id);

        if (breaks && breaks.length > 0) {
          await client.from("priceListItemBreak").insert(
            breaks.map((b) => ({
              priceListItemId: newItem.id,
              minQuantity: b.minQuantity,
              unitPrice: b.unitPrice,
              companyId,
              createdBy: userId
            }))
          );
        }
      }
    }
  }

  // Rules
  const { data: rules } = await client
    .from("priceListRule")
    .select("*")
    .eq("priceListId", sourceListId);

  if (rules && rules.length > 0) {
    await client.from("priceListRule").insert(
      rules.map((r) => ({
        priceListId: targetListId,
        name: r.name,
        ruleType: r.ruleType,
        amountType: r.amountType,
        amount: r.amount,
        minQuantity: r.minQuantity,
        maxQuantity: r.maxQuantity,
        customerTypeId: r.customerTypeId,
        itemId: r.itemId,
        itemPostingGroupId: r.itemPostingGroupId,
        validFrom: r.validFrom,
        validTo: r.validTo,
        active: r.active,
        companyId,
        createdBy: userId
      }))
    );
  }

  // Assignments
  const { data: assignments } = await client
    .from("priceListAssignment")
    .select("*")
    .eq("priceListId", sourceListId);

  if (assignments && assignments.length > 0) {
    await client.from("priceListAssignment").insert(
      assignments.map((a) => ({
        priceListId: targetListId,
        customerId: a.customerId,
        customerTypeId: a.customerTypeId,
        companyId,
        createdBy: userId
      }))
    );
  }
}

export async function duplicatePriceList(
  client: SupabaseClient<Database>,
  priceListId: string,
  companyId: string,
  userId: string
) {
  const { data: current, error: fetchError } = await getPriceList(
    client,
    priceListId
  );
  if (fetchError || !current) return { data: null, error: fetchError };

  const baseName = `Copy of ${current.name}`;
  let name = baseName;

  // Handle unique constraint: try base name, then append a counter
  const { data: existing } = await client
    .from("priceList")
    .select("id")
    .eq("name", baseName)
    .eq("version", 1)
    .eq("companyId", companyId)
    .maybeSingle();

  if (existing) {
    name = `${baseName} (${new Date().toISOString().slice(0, 10)})`;
  }

  const { data: newList, error: createError } = await client
    .from("priceList")
    .insert([
      {
        name,
        description: current.description,
        type: current.type,
        status: "Draft" as const,
        priceType: current.priceType,
        currencyCode: current.currencyCode,
        validFrom: current.validFrom,
        validTo: current.validTo,
        sequence: current.sequence,
        version: 1,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();

  if (createError || !newList) return { data: null, error: createError };

  await copyPriceListChildren(
    client,
    priceListId,
    newList.id,
    companyId,
    userId
  );

  return { data: newList, error: null };
}

export async function getPriceListVersions(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  // Get the name of this price list
  const { data: current } = await client
    .from("priceList")
    .select("name, companyId")
    .eq("id", priceListId)
    .single();

  if (!current) return { data: [], error: null };

  // Simple query: all versions with the same name (procedure pattern)
  const { data, error } = await client
    .from("priceList")
    .select("id, name, version, status, createdBy, createdAt")
    .eq("name", current.name)
    .eq("companyId", current.companyId)
    .order("version", { ascending: false });

  return { data: data ?? [], error };
}

export async function getActivePriceListsForCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string,
  customerTypeId: string | null,
  date: string,
  currencyCode?: string
) {
  let query = client
    .from("priceList")
    .select("*, priceListAssignment(*)")
    .eq("companyId", companyId)
    .eq("type", "Sales")
    .eq("status", "Active")
    .order("sequence", { ascending: true });

  if (currencyCode) {
    query = query.eq("currencyCode", currencyCode);
  }

  query = query.or(`validFrom.is.null,validFrom.lte.${date}`);
  query = query.or(`validTo.is.null,validTo.gte.${date}`);

  const { data, error } = await query;
  if (error || !data) return { data: null, error };

  // Filter to lists assigned to this customer/type or global (no assignments)
  const applicable = data.filter((pl) => {
    const assignments = (pl as any).priceListAssignment as Array<{
      customerId: string | null;
      customerTypeId: string | null;
    }>;

    if (!assignments || assignments.length === 0) return true;

    return assignments.some(
      (a) =>
        a.customerId === customerId ||
        (customerTypeId && a.customerTypeId === customerTypeId)
    );
  });

  return { data: applicable, error: null };
}

export async function getPriceListItemsForResolution(
  client: SupabaseClient<Database>,
  priceListId: string,
  itemId: string,
  itemPostingGroupId: string | null
) {
  // Try exact item match first
  const { data: itemMatch } = await client
    .from("priceListItem")
    .select("*, priceListItemBreak(*)")
    .eq("priceListId", priceListId)
    .eq("itemId", itemId)
    .maybeSingle();

  if (itemMatch) return { data: itemMatch, error: null, matchType: "item" };

  // Try category match
  if (itemPostingGroupId) {
    const { data: groupMatch } = await client
      .from("priceListItem")
      .select("*, priceListItemBreak(*)")
      .eq("priceListId", priceListId)
      .eq("itemPostingGroupId", itemPostingGroupId)
      .maybeSingle();

    if (groupMatch)
      return { data: groupMatch, error: null, matchType: "category" };
  }

  return { data: null, error: null, matchType: null };
}

export async function getApplicableRules(
  client: SupabaseClient<Database>,
  priceListId: string,
  quantity: number,
  customerTypeId: string | null,
  itemId: string,
  itemPostingGroupId: string | null,
  date: string
) {
  const { data: allRules, error } = await client
    .from("priceListRule")
    .select("*")
    .eq("priceListId", priceListId)
    .eq("active", true)
    .order("priority", { ascending: false });

  if (error || !allRules) return { data: null, error };

  const matched = allRules.filter((rule) => {
    if (rule.minQuantity !== null && quantity < rule.minQuantity) return false;
    if (rule.maxQuantity !== null && quantity > rule.maxQuantity) return false;

    if (rule.validFrom && date < rule.validFrom) return false;
    if (rule.validTo && date > rule.validTo) return false;

    if (rule.customerTypeId !== null && rule.customerTypeId !== customerTypeId)
      return false;
    if (rule.itemId !== null && rule.itemId !== itemId) return false;
    if (
      rule.itemPostingGroupId !== null &&
      rule.itemPostingGroupId !== itemPostingGroupId
    )
      return false;

    return true;
  });

  return { data: matched, error: null };
}

export async function getSalesOrdersByPriceList(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  return client
    .from("salesOrderLine")
    .select("salesOrderId, salesOrder!inner(id, salesOrderId)")
    .eq("priceListId", priceListId);
}

export async function getCustomersByDefaultPriceList(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  return client
    .from("customer")
    .select("id, name")
    .eq("priceListId", priceListId);
}

export async function getPriceListsForItem(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client
    .from("priceListItem")
    .select(
      "id, unitPrice, unitOfMeasureCode, pricingMethod, priceList!inner(id, name, status, type, currencyCode, sequence, version)"
    )
    .eq("itemId", itemId)
    .order("createdAt", { ascending: false });
}

export type AssignmentType = "direct" | "type" | "global";

export type PriceTraceStep = {
  step: string;
  source: string;
  amount: number;
  adjustment?: number;
};

export type MatchedRule = {
  id: string;
  name: string;
  ruleType: string;
  amountType: string;
  amount: number;
};

export type PriceResolutionInput = {
  customerId?: string;
  customerTypeId?: string;
  itemId: string;
  itemPostingGroupId?: string;
  quantity: number;
  date?: string;
  currencyCode?: string;
  exchangeRate?: number;
  existingBasePrice?: number;
};

export type PriceResolutionResult = {
  finalPrice: number;
  basePrice: number;
  priceListId: string | null;
  priceListName: string | null;
  priceType: "Gross" | "Net" | "Discounted";
  trace: PriceTraceStep[];
};

/**
 * Lower score = higher specificity = wins.
 * direct+item=0, direct+category=1, type+item=2, type+category=3,
 * global+item=4, global+category=5.
 */
export function specificityScore(
  assignmentType: AssignmentType,
  matchType: string | null
): number {
  const assignmentScore =
    assignmentType === "direct" ? 0 : assignmentType === "type" ? 2 : 4;
  const matchScore = matchType === "item" ? 0 : 1;
  return assignmentScore + matchScore;
}

/**
 * Apply discount and surcharge rules to a base price.
 *
 * Discounts: best-rate-wins, non-stacking. If the price list type is
 * "Discounted", discount rules are skipped entirely.
 * Markups: all stack additively.
 * Final price is clamped to >= 0.
 */
export function applyPriceRules(
  basePrice: number,
  matchedRules: MatchedRule[],
  winningPriceType: "Gross" | "Net" | "Discounted"
): { finalPrice: number; appendedTrace: PriceTraceStep[] } {
  const appendedTrace: PriceTraceStep[] = [];
  let finalPrice = basePrice;

  const surchargeRules = matchedRules.filter((r) => r.ruleType === "Markup");

  const discountRules =
    winningPriceType === "Discounted"
      ? []
      : matchedRules.filter((r) => r.ruleType === "Discount");

  if (
    winningPriceType === "Discounted" &&
    matchedRules.some((r) => r.ruleType === "Discount")
  ) {
    appendedTrace.push({
      step: "Discount",
      source: `Skipped — price list type is "Discounted" (discounts already applied)`,
      amount: finalPrice
    });
  }

  // Discounts: best rate wins (non-stacking)
  if (discountRules.length > 0) {
    let bestDiscount = 0;
    let bestRule: MatchedRule | null = null;

    for (const rule of discountRules) {
      const effective =
        rule.amountType === "Percentage"
          ? basePrice * rule.amount
          : rule.amount;

      if (effective > bestDiscount) {
        bestDiscount = effective;
        bestRule = rule;
      }
    }

    if (bestRule) {
      finalPrice -= bestDiscount;
      appendedTrace.push({
        step: "Discount",
        source: `Rule: ${bestRule.name}`,
        amount: finalPrice,
        adjustment: -bestDiscount
      });
    }
  }

  // Markups: all stack additively
  for (const rule of surchargeRules) {
    const adjustment =
      rule.amountType === "Percentage" ? basePrice * rule.amount : rule.amount;

    finalPrice += adjustment;
    appendedTrace.push({
      step: "Markup",
      source: `Rule: ${rule.name}`,
      amount: finalPrice,
      adjustment
    });
  }

  finalPrice = Math.max(0, finalPrice);

  return { finalPrice, appendedTrace };
}

async function computeFormulaPrice(
  client: SupabaseClient<Database>,
  itemId: string,
  formulaBase: string,
  markupPercent: number,
  minMarginPercent: number | null
): Promise<number> {
  let base = 0;
  let cost = 0;

  if (formulaBase === "salePrice") {
    const { data } = await client
      .from("itemUnitSalePrice")
      .select("unitSalePrice")
      .eq("itemId", itemId)
      .maybeSingle();
    base = data?.unitSalePrice ?? 0;
  }

  const { data: costData } = await client
    .from("itemCost")
    .select("unitCost")
    .eq("itemId", itemId)
    .maybeSingle();
  cost = costData?.unitCost ?? 0;

  if (formulaBase === "cost") {
    base = cost;
  }

  let price = base * (1 + markupPercent);

  if (minMarginPercent && minMarginPercent > 0 && cost > 0) {
    const minPrice = cost / (1 - minMarginPercent);
    price = Math.max(price, minPrice);
  }

  return Math.max(0, price);
}

function getAssignmentType(
  list: any,
  customerId?: string,
  customerTypeId?: string
): AssignmentType {
  const assignments = list.priceListAssignment as
    | Array<{
        customerId: string | null;
        customerTypeId: string | null;
      }>
    | undefined;

  if (!assignments || assignments.length === 0) return "global";

  const hasDirect = assignments.some((a) => a.customerId === customerId);
  if (hasDirect) return "direct";

  const hasType = assignments.some(
    (a) => customerTypeId && a.customerTypeId === customerTypeId
  );
  if (hasType) return "type";

  return "global";
}

export async function resolvePrice(
  client: SupabaseClient<Database>,
  companyId: string,
  input: PriceResolutionInput
): Promise<PriceResolutionResult> {
  const date = input.date ?? new Date().toISOString().split("T")[0]!;
  const trace: PriceTraceStep[] = [];

  let resolvedCustomerTypeId = input.customerTypeId ?? null;

  if (input.customerId && !resolvedCustomerTypeId) {
    const { data: cust } = await client
      .from("customer")
      .select("customerTypeId")
      .eq("id", input.customerId)
      .maybeSingle();
    resolvedCustomerTypeId = cust?.customerTypeId ?? null;
  }

  // ---------------------------------------------------------
  // Step 1: Find applicable price lists
  // ---------------------------------------------------------
  let applicableLists: any[] = [];

  if (input.customerId) {
    const { data } = await getActivePriceListsForCustomer(
      client,
      companyId,
      input.customerId,
      resolvedCustomerTypeId,
      date,
      input.currencyCode
    );
    if (data) applicableLists = data;
  }

  // ---------------------------------------------------------
  // Step 2: Resolve base price using specificity-based resolution
  // ---------------------------------------------------------
  let basePrice: number | null = null;
  let winningListId: string | null = null;
  let winningListName: string | null = null;
  let winningPriceType: "Gross" | "Net" | "Discounted" = "Net";
  let bestScore = Infinity;
  let bestSequence = Infinity;
  let bestMatchType: string | null = null;

  for (const list of applicableLists) {
    const assignmentType = getAssignmentType(
      list,
      input.customerId,
      resolvedCustomerTypeId ?? undefined
    );

    const result = await getPriceListItemsForResolution(
      client,
      list.id,
      input.itemId,
      input.itemPostingGroupId ?? null
    );

    if (result.data) {
      const score = specificityScore(assignmentType, result.matchType);
      const seq = list.sequence ?? 0;

      // Lower score wins. Within same score, lower sequence wins.
      if (score < bestScore || (score === bestScore && seq < bestSequence)) {
        const item = result.data as any;
        const breaks = (item.priceListItemBreak ?? []) as Array<{
          minQuantity: number;
          unitPrice: number;
        }>;

        if (item.pricingMethod === "Price Breaks" && breaks.length > 0) {
          // Price Breaks method: use quantity tiers exclusively
          const priceBreaks = breaks.map((b) => ({
            quantity: b.minQuantity,
            unitPrice: b.unitPrice
          }));
          // Fallback to lowest break price when qty is below all tiers
          const lowestBreak = priceBreaks.reduce((min, b) =>
            b.quantity < min.quantity ? b : min
          );
          basePrice = lookupPriceFromBreaks(
            priceBreaks,
            input.quantity,
            lowestBreak.unitPrice
          );
        } else if (item.pricingMethod === "Formula") {
          // Formula-based pricing: compute from cost or sale price
          basePrice = await computeFormulaPrice(
            client,
            input.itemId,
            item.formulaBase ?? "cost",
            item.markupPercent ?? 0,
            item.minMarginPercent
          );
        } else {
          // Fixed pricing (default)
          basePrice = item.unitPrice;
        }

        winningListId = list.id;
        winningListName = list.name;
        winningPriceType = list.priceType ?? "Net";
        bestScore = score;
        bestSequence = seq;
        bestMatchType = result.matchType;
      }
    }
  }

  // ---------------------------------------------------------
  // Step 3: Fallback base price
  // ---------------------------------------------------------
  if (basePrice === null) {
    if (input.existingBasePrice !== undefined) {
      basePrice = input.existingBasePrice;
      trace.push({
        step: "Base Price",
        source: "Item Unit Sale Price (fallback)",
        amount: basePrice
      });
    } else {
      const { data: salePrice } = await client
        .from("itemUnitSalePrice")
        .select("unitSalePrice")
        .eq("itemId", input.itemId)
        .maybeSingle();

      basePrice = salePrice?.unitSalePrice ?? 0;
      trace.push({
        step: "Base Price",
        source: "Item Unit Sale Price (fallback)",
        amount: basePrice
      });
    }
  } else {
    trace.push({
      step: "Base Price",
      source: `Price List: ${winningListName} (${bestMatchType} match)`,
      amount: basePrice
    });
  }

  // ---------------------------------------------------------
  // Step 4: Evaluate structured rules
  // ---------------------------------------------------------
  const listIdForRules = winningListId ?? applicableLists[0]?.id;

  let matchedRules: MatchedRule[] = [];

  if (listIdForRules) {
    const { data: rules } = await getApplicableRules(
      client,
      listIdForRules,
      input.quantity,
      resolvedCustomerTypeId,
      input.itemId,
      input.itemPostingGroupId ?? null,
      date
    );

    if (rules) {
      matchedRules = rules;
      if (!winningListId && rules.length > 0) {
        winningListId = listIdForRules;
        winningListName = applicableLists[0]?.name ?? null;
      }
    }
  }

  // ---------------------------------------------------------
  // Step 5: Apply adjustments (pure — see applyPriceRules above)
  // ---------------------------------------------------------
  const { finalPrice, appendedTrace } = applyPriceRules(
    basePrice,
    matchedRules,
    winningPriceType
  );
  trace.push(...appendedTrace);

  trace.push({
    step: "Final Price",
    source: "Resolved",
    amount: finalPrice
  });

  return {
    finalPrice,
    basePrice,
    priceListId: winningListId,
    priceListName: winningListName,
    priceType: winningPriceType,
    trace
  };
}

/**
 * Batch resolution for multiple items.
 */
export async function resolvePrices(
  client: SupabaseClient<Database>,
  companyId: string,
  inputs: PriceResolutionInput[]
): Promise<Map<string, PriceResolutionResult>> {
  const results = new Map<string, PriceResolutionResult>();

  for (const input of inputs) {
    const result = await resolvePrice(client, companyId, input);
    results.set(input.itemId, result);
  }

  return results;
}

export function datesIntersect(
  aFrom: string | null,
  aTo: string | null,
  bFrom: string | null,
  bTo: string | null
): boolean {
  if (aTo && bFrom && aTo < bFrom) return false;
  if (bTo && aFrom && bTo < aFrom) return false;
  return true;
}

type AssignmentRow = {
  customerId: string | null;
  customerTypeId: string | null;
};

export function scopesIntersect(
  a: AssignmentRow[],
  b: AssignmentRow[]
): boolean {
  if (a.length === 0 && b.length === 0) return true;
  if (a.length === 0 || b.length === 0) return false;

  const keys = (r: AssignmentRow): string[] =>
    [
      r.customerId && `c:${r.customerId}`,
      r.customerTypeId && `ct:${r.customerTypeId}`
    ].filter((k): k is string => Boolean(k));

  const bSet = new Set(b.flatMap(keys));
  return a.some((row) => keys(row).some((k) => bSet.has(k)));
}

export type PriceListOverlap = {
  id: string;
  name: string;
  version: number;
};

export async function getOverlappingPriceLists(
  client: SupabaseClient<Database>,
  companyId: string,
  priceListId: string
): Promise<PriceListOverlap[]> {
  const { data: self } = await client
    .from("priceList")
    .select("id, name, version, type, status, currencyCode, validFrom, validTo")
    .eq("id", priceListId)
    .single();
  if (!self || self.status !== "Active") return [];

  const { data: siblings } = await client
    .from("priceList")
    .select("id, name, version, type, status, currencyCode, validFrom, validTo")
    .eq("companyId", companyId)
    .eq("type", self.type)
    .eq("currencyCode", self.currencyCode)
    .eq("status", "Active")
    .neq("id", priceListId);
  if (!siblings || siblings.length === 0) return [];

  const candidateIds = siblings.map((s) => s.id);
  const { data: allAssignments } = await client
    .from("priceListAssignment")
    .select("priceListId, customerId, customerTypeId")
    .in("priceListId", [priceListId, ...candidateIds]);

  const byList = new Map<string, AssignmentRow[]>();
  for (const a of allAssignments ?? []) {
    const arr = byList.get(a.priceListId) ?? [];
    arr.push(a);
    byList.set(a.priceListId, arr);
  }
  const selfAssignments = byList.get(priceListId) ?? [];

  const overlaps: PriceListOverlap[] = [];
  for (const sib of siblings) {
    if (
      !datesIntersect(self.validFrom, self.validTo, sib.validFrom, sib.validTo)
    )
      continue;
    if (!scopesIntersect(selfAssignments, byList.get(sib.id) ?? [])) continue;
    overlaps.push({ id: sib.id, name: sib.name, version: sib.version });
  }

  return overlaps;
}

export async function getOverlapIdsForPriceLists(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<Set<string>> {
  const { data: activeLists } = await client
    .from("priceList")
    .select("id, currencyCode, validFrom, validTo")
    .eq("companyId", companyId)
    .eq("type", "Sales")
    .eq("status", "Active");
  if (!activeLists || activeLists.length < 2) return new Set();

  const ids = activeLists.map((l) => l.id);
  const { data: assignments } = await client
    .from("priceListAssignment")
    .select("priceListId, customerId, customerTypeId")
    .in("priceListId", ids);

  const byList = new Map<string, AssignmentRow[]>();
  for (const id of ids) byList.set(id, []);
  for (const a of assignments ?? []) byList.get(a.priceListId)?.push(a);

  const overlapping = new Set<string>();
  for (let i = 0; i < activeLists.length; i++) {
    for (let j = i + 1; j < activeLists.length; j++) {
      const a = activeLists[i];
      const b = activeLists[j];
      if (a.currencyCode !== b.currencyCode) continue;
      if (!datesIntersect(a.validFrom, a.validTo, b.validFrom, b.validTo))
        continue;
      if (!scopesIntersect(byList.get(a.id) ?? [], byList.get(b.id) ?? []))
        continue;
      overlapping.add(a.id);
      overlapping.add(b.id);
    }
  }
  return overlapping;
}
