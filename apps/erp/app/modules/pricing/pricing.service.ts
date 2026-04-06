import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  priceListAssignmentValidator,
  priceListItemValidator,
  priceListRuleValidator,
  priceListValidator
} from "./pricing.models";

// ============================================================
// Price Lists — Dropdown List
// ============================================================

export async function getPriceListsList(
  client: SupabaseClient<Database>,
  companyId: string,
  type: "Sales" | "Purchase"
) {
  return client
    .from("priceList")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("type", type)
    .in("status", ["Active", "Draft"])
    .order("name");
}

// ============================================================
// Price Lists — CRUD
// ============================================================

export async function getPriceLists(
  client: SupabaseClient<Database>,
  companyId: string,
  type: "Sales" | "Purchase",
  args?: GenericQueryFilters & {
    search?: string;
    customerId?: string;
    supplierId?: string;
  }
) {
  // If filtering by customer/supplier, first find matching price list IDs via assignments
  let priceListIds: string[] | null = null;

  if (args?.customerId || args?.supplierId) {
    let assignmentQuery = client
      .from("priceListAssignment")
      .select("priceListId")
      .eq("companyId", companyId);

    if (args.customerId) {
      assignmentQuery = assignmentQuery.eq("customerId", args.customerId);
    }
    if (args.supplierId) {
      assignmentQuery = assignmentQuery.eq("supplierId", args.supplierId);
    }

    const { data: assignments } = await assignmentQuery;
    priceListIds = (assignments ?? []).map((a) => a.priceListId);

    // Also include global lists (those with no assignments at all)
    const { data: allLists } = await client
      .from("priceList")
      .select("id")
      .eq("companyId", companyId)
      .eq("type", type);

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
    .eq("type", type);

  if (priceListIds !== null) {
    query = query.in("id", priceListIds);
  }

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    // Strip customerId/supplierId from filters before applying generic filters
    // (they don't exist as columns on priceList)
    const cleanedArgs = {
      ...args,
      filters: args.filters?.filter(
        (f) => f.column !== "customerId" && f.column !== "supplierId"
      )
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

export async function getPriceListType(
  client: SupabaseClient<Database>,
  priceListId: string
): Promise<"Sales" | "Purchase"> {
  const { data } = await client
    .from("priceList")
    .select("type")
    .eq("id", priceListId)
    .single();
  return (data?.type as "Sales" | "Purchase") ?? "Sales";
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
        type: data.type,
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

// ============================================================
// Price List Items — CRUD
// ============================================================

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

// ============================================================
// Price List Item Breaks
// ============================================================

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
  client: SupabaseClient<Database>,
  priceListItemId: string,
  companyId: string,
  userId: string,
  breaks: Array<{ minQuantity: number; unitPrice: number }>
) {
  // Delete existing breaks
  await client
    .from("priceListItemBreak")
    .delete()
    .eq("priceListItemId", priceListItemId);

  if (breaks.length === 0) return { data: [], error: null };

  // Insert new breaks
  return client.from("priceListItemBreak").insert(
    breaks.map((b) => ({
      priceListItemId,
      minQuantity: b.minQuantity,
      unitPrice: b.unitPrice,
      companyId,
      createdBy: userId
    }))
  );
}

// ============================================================
// Price List Rules — CRUD
// ============================================================

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
        supplierTypeId: data.supplierTypeId ?? null,
        itemId: data.itemId ?? null,
        itemPostingGroupId: data.itemPostingGroupId ?? null,
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

// ============================================================
// Price List Assignments — CRUD
// ============================================================

export async function getPriceListAssignments(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  return client
    .from("priceListAssignment")
    .select(
      "*, customer(id, name), customerType(id, name), supplier(id, name), supplierType(id, name)"
    )
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
        supplierId: data.supplierId ?? null,
        supplierTypeId: data.supplierTypeId ?? null,
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

// ============================================================
// Version Management
// ============================================================

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

// ------------------------------------------------------------
// Copy all children from one price list to another
// ------------------------------------------------------------

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
        supplierTypeId: r.supplierTypeId,
        itemId: r.itemId,
        itemPostingGroupId: r.itemPostingGroupId,
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
        supplierId: a.supplierId,
        supplierTypeId: a.supplierTypeId,
        companyId,
        createdBy: userId
      }))
    );
  }
}

// ------------------------------------------------------------
// Duplicate Price List (new name, version 1, source untouched)
// ------------------------------------------------------------

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

// ============================================================
// Sequence Management (drag-to-reorder)
// ============================================================

export async function updatePriceListSequence(
  client: SupabaseClient<Database>,
  id: string,
  sequence: number,
  userId: string
) {
  return client
    .from("priceList")
    .update({
      sequence,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id);
}

// ============================================================
// Overlap Validation
// ============================================================

export async function checkOverlappingPriceLists(
  client: SupabaseClient<Database>,
  companyId: string,
  priceListId: string,
  type: "Sales" | "Purchase",
  validFrom: string | null,
  validTo: string | null
) {
  // Find other Active price lists of the same type with overlapping dates
  let query = client
    .from("priceList")
    .select("id, name, validFrom, validTo")
    .eq("companyId", companyId)
    .eq("type", type)
    .eq("status", "Active")
    .neq("id", priceListId);

  const { data: candidates, error } = await query;
  if (error || !candidates) return { overlapping: [], error };

  // Get assignments for the target list
  const { data: targetAssignments } = await client
    .from("priceListAssignment")
    .select("customerId, customerTypeId, supplierId, supplierTypeId")
    .eq("priceListId", priceListId);

  const overlapping: Array<{ id: string; name: string }> = [];

  for (const candidate of candidates) {
    // Check date overlap: two ranges overlap unless one ends before the other starts
    const cFrom = candidate.validFrom;
    const cTo = candidate.validTo;

    // No dates means "always valid" — always overlaps
    const datesOverlap =
      (validFrom === null || cTo === null || validFrom <= cTo) &&
      (validTo === null || cFrom === null || validTo >= cFrom);

    if (!datesOverlap) continue;

    // Check assignment overlap: do they share any customers/suppliers?
    const { data: candidateAssignments } = await client
      .from("priceListAssignment")
      .select("customerId, customerTypeId, supplierId, supplierTypeId")
      .eq("priceListId", candidate.id);

    const targetIsGlobal = !targetAssignments || targetAssignments.length === 0;
    const candidateIsGlobal =
      !candidateAssignments || candidateAssignments.length === 0;

    // Both global = overlap; one global = overlap; both assigned = check intersection
    if (targetIsGlobal || candidateIsGlobal) {
      overlapping.push({ id: candidate.id, name: candidate.name });
      continue;
    }

    // Check if any assignments intersect
    const hasSharedAssignment = targetAssignments!.some((ta) =>
      candidateAssignments!.some(
        (ca) =>
          (ta.customerId && ta.customerId === ca.customerId) ||
          (ta.customerTypeId && ta.customerTypeId === ca.customerTypeId) ||
          (ta.supplierId && ta.supplierId === ca.supplierId) ||
          (ta.supplierTypeId && ta.supplierTypeId === ca.supplierTypeId)
      )
    );

    if (hasSharedAssignment) {
      overlapping.push({ id: candidate.id, name: candidate.name });
    }
  }

  return { overlapping, error: null };
}

// ============================================================
// Price Resolution Helpers (DB queries for the resolver)
// ============================================================

export async function getActivePriceListsForCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string,
  customerTypeId: string | null,
  date: string,
  currencyCode?: string
) {
  // Get all active Sales price lists for this company
  let query = client
    .from("priceList")
    .select("*, priceListAssignment(*)")
    .eq("companyId", companyId)
    .eq("type", "Sales")
    .eq("status", "Active")
    .order("sequence", { ascending: true });

  // Currency filtering — only return lists matching the order currency
  if (currencyCode) {
    query = query.eq("currencyCode", currencyCode);
  }

  // Date filtering
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

    // Global list — no assignments means it applies to everyone
    if (!assignments || assignments.length === 0) return true;

    return assignments.some(
      (a) =>
        a.customerId === customerId ||
        (customerTypeId && a.customerTypeId === customerTypeId)
    );
  });

  return { data: applicable, error: null };
}

export async function getActivePriceListsForSupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string,
  supplierTypeId: string | null,
  date: string,
  currencyCode?: string
) {
  let query = client
    .from("priceList")
    .select("*, priceListAssignment(*)")
    .eq("companyId", companyId)
    .eq("type", "Purchase")
    .eq("status", "Active")
    .order("sequence", { ascending: true });

  if (currencyCode) {
    query = query.eq("currencyCode", currencyCode);
  }

  query = query.or(`validFrom.is.null,validFrom.lte.${date}`);
  query = query.or(`validTo.is.null,validTo.gte.${date}`);

  const { data, error } = await query;
  if (error || !data) return { data: null, error };

  const applicable = data.filter((pl) => {
    const assignments = (pl as any).priceListAssignment as Array<{
      supplierId: string | null;
      supplierTypeId: string | null;
    }>;

    if (!assignments || assignments.length === 0) return true;

    return assignments.some(
      (a) =>
        a.supplierId === supplierId ||
        (supplierTypeId && a.supplierTypeId === supplierTypeId)
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

// ============================================================
// Structured Rule Evaluation (replaces json-rules-engine)
// ============================================================

export async function getApplicableRules(
  client: SupabaseClient<Database>,
  priceListId: string,
  quantity: number,
  customerTypeId: string | null,
  supplierTypeId: string | null,
  itemId: string,
  itemPostingGroupId: string | null
) {
  // Fetch all active rules for this price list
  const { data: allRules, error } = await client
    .from("priceListRule")
    .select("*")
    .eq("priceListId", priceListId)
    .eq("active", true)
    .order("priority", { ascending: false });

  if (error || !allRules) return { data: null, error };

  // Filter in-memory: a rule matches if ALL its non-null scope fields match
  const matched = allRules.filter((rule) => {
    // Quantity range check
    if (rule.minQuantity !== null && quantity < rule.minQuantity) return false;
    if (rule.maxQuantity !== null && quantity > rule.maxQuantity) return false;

    // Scope field checks (NULL = applies to all)
    if (rule.customerTypeId !== null && rule.customerTypeId !== customerTypeId)
      return false;
    if (rule.supplierTypeId !== null && rule.supplierTypeId !== supplierTypeId)
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

// ============================================================
// Cross-Entity Lookups (for surfacing on detail pages)
// ============================================================

export async function getSalesOrdersByPriceList(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  return client
    .from("salesOrderLine")
    .select("salesOrderId, salesOrder!inner(id, salesOrderId)")
    .eq("priceListId", priceListId);
}

export async function getPurchaseOrdersByPriceList(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  return client
    .from("purchaseOrderLine")
    .select("purchaseOrderId, purchaseOrder!inner(id, purchaseOrderId)")
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

export async function getSuppliersByDefaultPriceList(
  client: SupabaseClient<Database>,
  priceListId: string
) {
  return client
    .from("supplier")
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
