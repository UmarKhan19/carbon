import type { Database, Json } from "@carbon/database";
import type { OnshapeClient } from "@carbon/ee/onshape";
import { getOnshapeClient, OnshapeElementType } from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";
import { getReadableIdWithRevision } from "~/utils/string";
import {
  addChangeOrderItem,
  createPendingRevision,
  deleteChangeOrder,
  deleteChangeOrderItem,
  getOpenChangeOrderForItem,
  insertChangeOrder
} from "../items/changeOrder.service";
import { deleteItem, getMakeMethods, upsertPart } from "../items/items.service";
import { pullDrawingForRevision } from "./onshape-drawing.server";
import { pullGeometryForRevision } from "./onshape-geometry.server";

// =============================================================================
// OnShape import orchestrator — the "ECO-spine".
//
// This is a Supabase-client (PostgREST) ordered pipeline with explicit
// rollback-on-failure, NOT a single Kysely transaction: every step it composes
// already writes via the Supabase client and invokes edge functions (`create`,
// `get-method`, `sync`) that cannot enroll in a Kysely tx (mirrors how
// item.update.tsx chains addChangeOrderItem -> createPendingRevision without a
// transaction). Per the verifier correction, ONE service-role client is threaded
// through for all reads/writes AND the `sync` invoke (service_role passes the
// edge fn's requirePermissions); auth is enforced at the route via
// requirePermissions + scoped by companyId.
// =============================================================================

// -----------------------------------------------------------------------------
// Public result / input types
// -----------------------------------------------------------------------------

export type OnshapeImportResult = {
  itemId: string; // resolved/created carbon item.id (the new revision)
  changeOrderId: string; // the CO uuid (changeOrder.id) — for path.to.changeOrder()
  changeOrderReadableId: string;
  changeOrderItemId: string;
  makeMethodId: string; // the new revision's Draft makeMethod
  revision: string; // carbon-computed label
  created: boolean; // true if base item family was created
  // Task 25 — per-object NON-FATAL warnings (drawing/geometry pull failures).
  // The ECO + BOM still land; the UI can surface "drawing not pulled" etc.
  warnings?: string[];
};

export type OnshapeReleasedObject = {
  partNumber: string; // OnShape PN -> readableId. REQUIRED (refuse on null upstream)
  revisionLabel: string; // OnShape literal label e.g. "B"
  name: string;
  description?: string;
  revisionId: string; // OnShape immutable revisionId -> externalId
  did: string;
  sourceVid: string; // pinned Version read-anchor
  eid: string;
  // Element type of the released object's geometry source — routes the STEP
  // translation (assembly vs part studio) in Task 24. Defaults to ASSEMBLY when
  // absent (the released object is most often an assembly).
  elementType?: OnshapeElementType;
  mid?: string;
  configurationId?: string | null;
  fullConfiguration?: string | null;
  bomRows: BomRow[]; // already-flattened rows (Task 11)
  extraMetadata?: Record<string, unknown>; // massProps, schemeType, isStandardContent, drawingRevisionLabel
};

// -----------------------------------------------------------------------------
// Task 11 — BomRow shape + sync-payload normalize.
// (Moved up from Task 11 into the top of the file per the verifier correction:
//  Task 9's base-item creation references pickTopRow, so BomRow / pickTopRow must
//  be defined before resolveItemFamily / createBaseItem use them.)
// -----------------------------------------------------------------------------

type ReplenishmentSystem = "Buy" | "Make" | "Buy and Make";
type DefaultMethodType =
  | "Make to Order"
  | "Purchase to Order"
  | "Pull from Inventory";

export type BomRow = {
  index: string;
  readableId?: string;
  revision?: string;
  readableIdWithRevision: string;
  name: string;
  id?: string;
  replenishmentSystem: ReplenishmentSystem;
  defaultMethodType: DefaultMethodType;
  // Raw OnShape "Quantity" is a STRING; sync requires z.number(). We keep the
  // union here and coerce with Number(...) in toSyncPayloadRows (verifier
  // correction · Task 11). Without this, payloadValidator.parse throws.
  quantity: number | string;
  level: number;
  data: Record<string, any>;
};

// The `sync` validator (sync/index.ts onShapeDataValidator) requires
// { index, name, quantity:number, replenishmentSystem, defaultMethodType, data }
// with id/readableId/revision optional. Field names must match EXACTLY or `sync`
// throws at payloadValidator.parse.
type SyncPayloadRow = {
  id?: string;
  index: string;
  readableId?: string;
  revision?: string;
  name: string;
  quantity: number;
  replenishmentSystem: ReplenishmentSystem;
  defaultMethodType: DefaultMethodType;
  data: Record<string, any>;
};

export function toSyncPayloadRows(bomRows: BomRow[]): SyncPayloadRow[] {
  return bomRows.map((row) => {
    // COERCE — raw OnShape quantity is a string; sync requires z.number().
    // Guard against NaN / non-positive values; default to 1 (mirrors the
    // importComponents BOM-qty default).
    const q = Number(row.quantity);
    return {
      id: row.id,
      index: row.index,
      readableId: row.readableId,
      revision: row.revision,
      name: row.name,
      quantity: Number.isFinite(q) && q > 0 ? q : 1,
      replenishmentSystem: row.replenishmentSystem,
      defaultMethodType: row.defaultMethodType,
      data: row.data
    };
  });
}

// The top-level assembly row (index === "1" or, failing that, the lowest level)
// supplies replenishment/method defaults for the family head in createBaseItem.
export function pickTopRow(bomRows: BomRow[]): BomRow | undefined {
  if (bomRows.length === 0) return undefined;
  const byIndex = bomRows.find((r) => r.index === "1");
  if (byIndex) return byIndex;
  return bomRows.reduce((lowest, row) =>
    row.level < lowest.level ? row : lowest
  );
}

// -----------------------------------------------------------------------------
// Task 9 — identity resolution + base-item creation + open/attach Draft CO.
// -----------------------------------------------------------------------------

type ResolveItemFamily =
  | { kind: "alreadySynced"; itemId: string }
  | { kind: "family"; itemId: string }
  | { kind: "none" };

async function resolveItemFamily(
  client: SupabaseClient<Database>,
  args: { revisionId: string; partNumber: string; companyId: string }
): Promise<{
  data: ResolveItemFamily | null;
  error: { message: string } | null;
}> {
  // resolveByRevisionId — has this exact revision already been synced?
  const synced = await client
    .from("externalIntegrationMapping")
    .select("entityId, metadata")
    .eq("entityType", "item")
    .eq("integration", "onshape")
    .eq("externalId", args.revisionId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (synced.error) {
    return { data: null, error: { message: synced.error.message } };
  }
  if (synced.data?.entityId) {
    return {
      data: { kind: "alreadySynced", itemId: synced.data.entityId },
      error: null
    };
  }

  // resolveFamilyByPartNumber — any existing Part with readableId === partNumber.
  // createPendingRevision recomputes the next revision against ALL existing rows
  // of (readableId, type, companyId), so any seed gives the right next label; but
  // createRevision CLONES the seed's method tree, so the seed choice is material.
  // Seed off the active released revision (revisionStatus === 'Production') when
  // present — it is the canonical baseline; otherwise fall back to the
  // newest-by-createdAt member.
  const family = await client
    .from("item")
    .select(
      "id, readableId, revision, revisionStatus, type, replenishmentSystem, defaultMethodType"
    )
    .eq("readableId", args.partNumber)
    .eq("companyId", args.companyId)
    .eq("type", "Part")
    .order("createdAt", { ascending: false });

  if (family.error) {
    return { data: null, error: { message: family.error.message } };
  }

  const members = family.data ?? [];
  if (members.length > 0) {
    const production = members.find((m) => m.revisionStatus === "Production");
    // members is already ordered newest-first, so members[0] is the newest.
    const seed = production ?? members[0];
    return { data: { kind: "family", itemId: seed.id }, error: null };
  }

  return { data: { kind: "none" }, error: null };
}

async function createBaseItem(
  client: SupabaseClient<Database>,
  args: {
    object: OnshapeReleasedObject;
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const { object, companyId, userId } = args;
  const top = pickTopRow(object.bomRows);

  // DECISION: create the family head at revision "0" — Carbon auto-computes the
  // next revision label on createPendingRevision; do NOT seed OnShape's literal
  // label. Replenishment/method default off the BOM top row (falling back to a
  // Make assembly head when there is no BOM row to read).
  const part = await upsertPart(client, {
    id: object.partNumber,
    revision: "0",
    name: object.name,
    description: object.description,
    replenishmentSystem: top?.replenishmentSystem ?? "Make",
    defaultMethodType: top?.defaultMethodType ?? "Make to Order",
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA",
    // shelfLifeCalculateFromBom is a checkbox (boolean) on partValidator.
    shelfLifeCalculateFromBom: false,
    companyId,
    createdBy: userId
  });

  if (part.error || !part.data) {
    return {
      data: null,
      error: { message: part.error?.message ?? "Failed to create base item" }
    };
  }

  return { data: { id: part.data.id }, error: null };
}

type OpenOrAttachResult = {
  id: string; // CO uuid
  changeOrderId: string; // human readable e.g. CO-0001
  attached: boolean; // true when an existing open CO was attached (not created)
  // The resolved changeOrderItem row for (id, itemId). On the ATTACH branch this
  // is the PRE-EXISTING row (getOpenChangeOrderForItem found the CO precisely
  // because a changeOrderItem already maps this item), so the caller must NOT
  // re-insert one — that would violate UNIQUE(changeOrderId, itemId) (23505).
  // On the CREATE branch it is null and the caller inserts it.
  changeOrderItemId: string | null;
};

async function openOrAttachDraftCO(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    object: OnshapeReleasedObject;
    companyId: string;
    userId: string;
  }
): Promise<{
  data: OpenOrAttachResult | null;
  error: { message: string } | null;
}> {
  const { itemId, object, companyId, userId } = args;

  // getOpenChangeOrderForItem returns the HUMAN changeOrderId (e.g. CO-0001),
  // NOT the uuid (verifier correction · FLAG 4). On a hit we re-fetch the uuid by
  // querying changeOrder by human-id and attach (do not create).
  const open = await getOpenChangeOrderForItem(client, { itemId, companyId });
  if (open.error) {
    return { data: null, error: { message: open.error.message } };
  }

  if (open.data?.changeOrderId) {
    const co = await client
      .from("changeOrder")
      .select("id, changeOrderId, status")
      .eq("changeOrderId", open.data.changeOrderId)
      .eq("companyId", companyId)
      .single();
    if (co.error || !co.data) {
      return {
        data: null,
        error: { message: co.error?.message ?? "Open change order not found" }
      };
    }

    // ATTACH: the open CO already has a changeOrderItem for this item (that is how
    // getOpenChangeOrderForItem located it). SELECT and reuse it instead of
    // inserting — inserting would violate UNIQUE(changeOrderId, itemId) (23505).
    const existing = await client
      .from("changeOrderItem")
      .select("id, pendingItemId")
      .eq("changeOrderId", co.data.id)
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (existing.error) {
      return { data: null, error: { message: existing.error.message } };
    }
    if (!existing.data) {
      return {
        data: null,
        error: {
          message: `Open change order (${co.data.changeOrderId}) is missing its change order item for this item`
        }
      };
    }
    // POLICY: never stack a second pending revision on the same open CO line. If
    // this line already carries a pendingItemId, refuse — the operator must
    // resolve (release/cancel) the in-flight revision before re-importing.
    if (existing.data.pendingItemId) {
      return {
        data: null,
        error: {
          message: `An open change order (${co.data.changeOrderId}) already has a pending revision for this item; resolve it before importing again.`
        }
      };
    }

    return {
      data: {
        id: co.data.id,
        changeOrderId: co.data.changeOrderId,
        attached: true,
        changeOrderItemId: existing.data.id
      },
      error: null
    };
  }

  // No open CO — create a Draft one. changeOrder.status DB-defaults to 'Draft'
  // (status is not an insertChangeOrder param). approvalType "First-In" is the
  // lowest-friction allowed changeOrderApprovalType. sourceId is the OnShape
  // revisionId for Increments 1–2 (spec §3.2 says releasePackageId — an
  // Increment-3 concept; we diverge intentionally here).
  const created = await insertChangeOrder(client, {
    name: `OnShape import — ${object.partNumber} Rev ${object.revisionLabel}`,
    type: "Engineering",
    approvalType: "First-In",
    openDate: new Date().toISOString().split("T")[0],
    sourceType: "onshape",
    sourceId: object.revisionId,
    companyId,
    createdBy: userId
  });

  if (created.error || !created.data) {
    return {
      data: null,
      error: {
        message: created.error?.message ?? "Failed to create change order"
      }
    };
  }

  return {
    data: {
      id: created.data.id,
      changeOrderId: created.data.changeOrderId,
      attached: false,
      changeOrderItemId: null
    },
    error: null
  };
}

// -----------------------------------------------------------------------------
// Task 12 — match-not-create + phantom flagging (pre-resolve child ids).
//
// Spec §3.6 match-not-create option (b): pre-resolve every child item id so
// `sync` always takes its update branch and never creates a new revisioned item.
// Library/standard parts with no Carbon match retain sync's create-as-Buy
// behavior for v1.
// -----------------------------------------------------------------------------

async function resolveChildren(
  client: SupabaseClient<Database>,
  args: { bomRows: BomRow[]; companyId: string }
): Promise<{ data: BomRow[] | null; error: { message: string } | null }> {
  const { bomRows, companyId } = args;

  const uniquePNs = new Set(
    bomRows.map((r) => r.readableIdWithRevision).filter(Boolean)
  );

  let matchMap = new Map<string, string>();
  if (uniquePNs.size > 0) {
    const items = await client
      .from("item")
      .select("id, readableIdWithRevision")
      .in("readableIdWithRevision", Array.from(uniquePNs))
      .eq("companyId", companyId);

    if (items.error) {
      return { data: null, error: { message: items.error.message } };
    }
    matchMap = new Map(
      (items.data ?? [])
        .filter((i): i is { id: string; readableIdWithRevision: string } =>
          Boolean(i.readableIdWithRevision)
        )
        .map((i) => [i.readableIdWithRevision, i.id])
    );
  }

  // IMMUTABILITY (self-review #3): the caller owns `bomRows` (it is part of the
  // caller-supplied `object`). Do NOT mutate `row.id` / `row.data` in place —
  // build and return NEW rows so the caller's input is never observably changed.
  const resolvedRows: BomRow[] = bomRows.map((row) => {
    const match = matchMap.get(row.readableIdWithRevision);

    // Phantom flagging — excludeFromBom / not-revision-managed / obsoleted.
    // VERIFY-LIVE: exact OnShape BOM column keys are unconfirmed; likely
    // "Exclude from BOM" / "Purchasing Level". Dump a real BOM row's data keys
    // with apps/erp/__plm-import-verify.mts before hard-coding strings.
    const data = row.data ?? {};
    let phantomReason: string | null = null;
    if (
      data["Exclude from BOM"] === true ||
      data["Exclude from BOM"] === "true"
    ) {
      phantomReason = "excludeFromBom";
    } else if (
      typeof data["State"] === "string" &&
      data["State"].toLowerCase() === "obsolete"
    ) {
      phantomReason = "obsolete";
    } else if (data["Revision managed"] === false) {
      phantomReason = "notRevisionManaged";
    }

    return {
      ...row,
      // -> sync update branch (never creates a new revisioned item).
      ...(match ? { id: match } : {}),
      data: phantomReason
        ? {
            ...data,
            __carbonPhantom: true,
            __carbonPhantomReason: phantomReason
          }
        : data
    };
  });

  return { data: resolvedRows, error: null };
}

// -----------------------------------------------------------------------------
// Task 13 — invoke `sync` against the new revision's Draft makeMethod + persist
// phantom metadata.
// -----------------------------------------------------------------------------

async function loadBomIntoRevision(
  serviceClient: SupabaseClient<Database>,
  args: {
    makeMethodId: string;
    rows: BomRow[];
    companyId: string;
    userId: string;
  }
): Promise<{ error: { message: string } | null }> {
  const { makeMethodId, rows, companyId, userId } = args;

  // Invoke the `sync` edge fn (service-role passes its requirePermissions).
  // Because makeMethodId is the Draft makeMethod from Task 10, `sync` writes in
  // place — its Active-fork branch fires only when status === "Active".
  const sync = await serviceClient.functions.invoke("sync", {
    body: {
      type: "onshape",
      makeMethodId,
      data: toSyncPayloadRows(rows),
      companyId,
      userId
    }
  });

  if (sync.error) {
    // Surface the underlying PostgresError/edge-fn message — a generic string
    // hides the real cause (mirrors integrations.onshape.sync.ts:55).
    console.error("OnShape sync failed", sync.error);
    return {
      error: {
        message: `Failed to load OnShape BOM into revision: ${sync.error.message}`
      }
    };
  }

  // Phantom-metadata persistence — CONFIRMED gap: `sync` does NOT set any
  // methodMaterial metadata field (sync/index.ts:711-723 has no such field).
  // methodMaterial has no `metadata` column either — only `customFields` (Json),
  // which is the established place for arbitrary JSON on these rows. We scope the
  // follow-up update by (makeMethodId, itemId) and accept MULTIPLE matched rows
  // (a child can appear at multiple BOM positions) — verifier correction · Task 13.
  // FLAG to the sync-edge-fn owner: if they add row-data->methodMaterial
  // passthrough in `sync`, delete this follow-up.
  const phantomRows = rows.filter(
    (r) => r.data?.__carbonPhantom === true && r.id
  );
  for (const row of phantomRows) {
    // READ-MERGE-WRITE: customFields is a single Json column, so blindly
    // .update({ customFields: {...} }) clobbers any pre-existing keys. SELECT the
    // matched rows' current customFields first and update each by id, spreading
    // the phantom keys over the existing object so prior keys survive. The
    // (makeMethodId, itemId) scope can match MULTIPLE rows (a child can appear at
    // several BOM positions) — handle them all.
    const existingRows = await serviceClient
      .from("methodMaterial")
      .select("id, customFields")
      .eq("makeMethodId", makeMethodId)
      .eq("itemId", row.id as string)
      .eq("companyId", companyId);
    if (existingRows.error) {
      console.error("Failed to read phantom metadata", existingRows.error);
      continue;
    }
    for (const existing of existingRows.data ?? []) {
      const merged: Json = {
        ...((existing.customFields as Record<string, Json> | null) ?? {}),
        __carbonPhantom: true,
        __carbonPhantomReason: row.data?.__carbonPhantomReason ?? null
      };
      const update = await serviceClient
        .from("methodMaterial")
        .update({ customFields: merged })
        .eq("id", existing.id)
        .eq("companyId", companyId);
      if (update.error) {
        // Non-fatal — the BOM is already loaded; phantom annotation is advisory.
        console.error("Failed to persist phantom metadata", update.error);
      }
    }
  }

  return { error: null };
}

// -----------------------------------------------------------------------------
// Task 14 — write the revision-level externalIntegrationMapping.
//
// BLOCKER (verifier correction): do NOT .upsert(..., { onConflict }) — the
// (integration, externalId, entityType, companyId) unique index is PARTIAL
// (WHERE allowDuplicateExternalId = false), which PostgREST cannot use as a
// conflict target. Mirror the existing route's delete-then-insert
// (integrations.onshape.sync.ts:65-83). Idempotency on re-run is preserved.
// Single writer of this row = the orchestrator.
// -----------------------------------------------------------------------------

async function writeRevisionMapping(
  client: SupabaseClient<Database>,
  args: {
    newItemId: string;
    object: OnshapeReleasedObject;
    companyId: string;
    // Pre-built merged metadata (self-review #3): the caller assembles this from
    // object.extraMetadata + any drawing fields WITHOUT mutating the caller-owned
    // object. When omitted we fall back to object.extraMetadata (the initial
    // write, before the drawing/geometry pulls have run — self-review #2).
    extraMetadata?: Record<string, unknown>;
  }
): Promise<{ error: { message: string } | null }> {
  const { newItemId, object, companyId } = args;
  const now = new Date().toISOString();

  const metadata: Json = {
    did: object.did,
    sourceVid: object.sourceVid,
    eid: object.eid,
    mid: object.mid ?? null,
    partNumber: object.partNumber,
    revisionLabel: object.revisionLabel,
    configurationId: object.configurationId ?? null,
    fullConfiguration: object.fullConfiguration ?? null,
    // Increment-2 fields (drawingRevisionLabel, drawingPath, massProps,
    // isStandardContent, schemeType) ride in via extraMetadata.
    ...(args.extraMetadata ?? object.extraMetadata ?? {})
  } as Json;

  // DELETE by (entityType, entityId, integration='onshape') THEN INSERT.
  const del = await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", "item")
    .eq("entityId", newItemId)
    .eq("integration", "onshape")
    .eq("companyId", companyId);
  if (del.error) {
    return { error: { message: del.error.message } };
  }

  // NOTE (spec §8 open question "onshapeData vs onshape"): the revision-level
  // `onshape` row's entityId is the NEW revision item, so it does not collide
  // with the legacy per-line `onshapeData` row written by `sync`. Both are kept
  // for Increment 1 — do not consolidate.
  const ins = await client.from("externalIntegrationMapping").insert({
    entityType: "item",
    entityId: newItemId,
    integration: "onshape",
    externalId: object.revisionId,
    metadata,
    lastSyncedAt: now,
    remoteUpdatedAt: now,
    allowDuplicateExternalId: false,
    companyId
  });
  if (ins.error) {
    return { error: { message: ins.error.message } };
  }

  return { error: null };
}

// -----------------------------------------------------------------------------
// Self-review #2 — PATCH the existing mapping row's metadata.
//
// The initial writeRevisionMapping lands BEFORE the (slow) drawing/geometry
// pulls so a request kill mid-pull cannot lose the idempotency row. AFTER the
// pulls we merge the resolved drawing fields (drawingPath/drawingRevisionLabel)
// into the existing row's metadata in place — a SELECT-MERGE-UPDATE that
// preserves the keys already written and does NOT re-insert (which would 23505).
// -----------------------------------------------------------------------------

async function patchRevisionMappingMetadata(
  client: SupabaseClient<Database>,
  args: {
    newItemId: string;
    companyId: string;
    patch: Record<string, unknown>;
  }
): Promise<{ error: { message: string } | null }> {
  const { newItemId, companyId, patch } = args;
  if (Object.keys(patch).length === 0) return { error: null };

  const existing = await client
    .from("externalIntegrationMapping")
    .select("id, metadata")
    .eq("entityType", "item")
    .eq("entityId", newItemId)
    .eq("integration", "onshape")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    return { error: { message: existing.error.message } };
  }
  if (!existing.data) {
    // The initial write should have landed; nothing to patch otherwise.
    return { error: null };
  }

  const merged: Json = {
    ...((existing.data.metadata as Record<string, Json> | null) ?? {}),
    ...(patch as Record<string, Json>)
  };

  const update = await client
    .from("externalIntegrationMapping")
    .update({ metadata: merged, lastSyncedAt: new Date().toISOString() })
    .eq("id", existing.data.id)
    .eq("companyId", companyId);
  if (update.error) {
    return { error: { message: update.error.message } };
  }

  return { error: null };
}

// -----------------------------------------------------------------------------
// Idempotent short-circuit — this revisionId already maps to a Carbon revision.
//
// Re-running the import for the same OnShape revisionId must NOT create a second
// revision/CO and must NOT re-write the mapping (the (integration, externalId,
// entityType) row already exists → re-insert would 23505). Instead, return the
// EXISTING revision item plus the open change order it lives on, so the route can
// redirect the operator straight to the in-flight CO.
// -----------------------------------------------------------------------------

async function resolveAlreadySyncedResult(
  client: SupabaseClient<Database>,
  args: {
    existingItemId: string;
    bomRows: BomRow[];
    companyId: string;
    userId: string;
  }
): Promise<{
  data: OnshapeImportResult | null;
  error: { message: string } | null;
}> {
  const { existingItemId, companyId } = args;

  // The mapping's entityId is the previously-created revision item. Read its
  // revision label so the result is faithful.
  const existingItem = await client
    .from("item")
    .select("id, revision")
    .eq("id", existingItemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (existingItem.error) {
    return { data: null, error: { message: existingItem.error.message } };
  }
  if (!existingItem.data) {
    return {
      data: null,
      error: { message: "Already-synced revision item no longer exists" }
    };
  }

  // Locate the open change order. The revision item is referenced by a
  // changeOrderItem either directly (itemId) or as the pending revision
  // (pendingItemId) of the affected base item's line. Find the line that carries
  // it as the pending revision first; fall back to itemId.
  const coItem = await client
    .from("changeOrderItem")
    .select(
      "id, changeOrderId, itemId, pendingItemId, changeOrder:changeOrderId(id, changeOrderId, status)"
    )
    .or(`pendingItemId.eq.${existingItemId},itemId.eq.${existingItemId}`)
    .eq("companyId", companyId)
    .limit(1)
    .maybeSingle();
  if (coItem.error) {
    return { data: null, error: { message: coItem.error.message } };
  }
  if (!coItem.data) {
    return {
      data: null,
      error: {
        message:
          "Already-synced revision has no change order line; resolve it in Carbon before re-importing"
      }
    };
  }

  const co = coItem.data.changeOrder as {
    id: string;
    changeOrderId: string;
    status: string;
  } | null;
  if (!co) {
    return {
      data: null,
      error: { message: "Already-synced revision's change order not found" }
    };
  }

  // Resolve the revision's Draft make method for the result contract.
  const mms = await getMakeMethods(client, existingItemId, companyId);
  if (mms.error) {
    return { data: null, error: { message: mms.error.message } };
  }
  const draft = mms.data?.find((m) => m.status === "Draft") ?? null;
  if (!draft) {
    return {
      data: null,
      error: {
        message: `No Draft make method found for already-synced revision ${existingItemId}`
      }
    };
  }

  return {
    data: {
      itemId: existingItemId,
      changeOrderId: co.id,
      changeOrderReadableId: co.changeOrderId,
      changeOrderItemId: coItem.data.id,
      makeMethodId: draft.id,
      revision: existingItem.data.revision ?? "0",
      created: false
    },
    error: null
  };
}

// -----------------------------------------------------------------------------
// Task 10 + Task 15 — per-object orchestration with rollback.
// -----------------------------------------------------------------------------

export async function importOnshapeReleasedObject(
  serviceClient: SupabaseClient<Database>,
  args: {
    object: OnshapeReleasedObject;
    companyId: string;
    userId: string;
    // Task 25 — the live OnShape client used for the drawing/geometry pull. When
    // omitted (e.g. a caller that does not need the SSOT files), the pull is
    // skipped silently. importReleasedRevision threads the client it already
    // built. The Kysely db is resolved internally via getDatabaseClient().
    onshapeClient?: OnshapeClient;
  }
): Promise<{
  data: OnshapeImportResult | null;
  error: { message: string } | null;
}> {
  const { object, companyId, userId, onshapeClient } = args;

  // Refusal guard (defense-in-depth, spec §3.2 step 1).
  if (!object.partNumber?.trim()) {
    return {
      data: null,
      error: {
        message: "OnShape object has no Part Number — release it first"
      }
    };
  }

  // Pre-resolve child ids + phantom flags. resolveChildren returns NEW rows —
  // the caller's object.bomRows is never mutated (self-review #3).
  const resolved = await resolveChildren(serviceClient, {
    bomRows: object.bomRows,
    companyId
  });
  if (resolved.error || !resolved.data) {
    return {
      data: null,
      error: resolved.error ?? { message: "Failed to resolve BOM children" }
    };
  }
  const bomRows = resolved.data;

  // Identity resolution.
  const family = await resolveItemFamily(serviceClient, {
    revisionId: object.revisionId,
    partNumber: object.partNumber,
    companyId
  });
  if (family.error || !family.data) {
    return {
      data: null,
      error: family.error ?? { message: "Failed to resolve item family" }
    };
  }

  // Rollback bookkeeping — only delete what THIS call created.
  let createdBaseItemId: string | null = null;
  let createdCoUuid: string | null = null;
  let createdChangeOrderItemId: string | null = null;
  let createdRevisionItemId: string | null = null;
  // Increment-2 SSOT artifacts created by the drawing/geometry pull. Tracked so
  // rollback can best-effort delete the modelUpload row AND storage.remove() the
  // uploaded STEP/PDF objects — otherwise a post-pull failure (e.g.
  // writeRevisionMapping) would orphan a blob in the `private` bucket and a
  // modelUpload row pointing at it (Batch-B fix · blob/row leak).
  let createdModelUploadId: string | null = null;
  const createdStoragePaths: string[] = [];

  const rollback = async () => {
    // Best-effort; ignore secondary failures.
    // Remove the uploaded STEP/PDF objects from the `private` bucket first
    // (separate non-transactional HTTP; mirror the best-effort .then(noop,noop)
    // style used in uploadOnshapeModelUpload's cleanup).
    if (createdStoragePaths.length > 0) {
      await serviceClient.storage
        .from("private")
        .remove(createdStoragePaths)
        .then(
          () => {},
          (e) => console.error("onshape rollback cleanup failed (storage)", e)
        );
    }
    // Delete the orphaned modelUpload row (the geometry pull set
    // item.modelUploadId; deleting the revision item below clears that FK side,
    // but the modelUpload row itself has no cascade — remove it explicitly).
    if (createdModelUploadId) {
      await serviceClient
        .from("modelUpload")
        .delete()
        .eq("id", createdModelUploadId)
        .eq("companyId", companyId)
        .then(
          () => {},
          (e) =>
            console.error("onshape rollback cleanup failed (modelUpload)", e)
        );
    }
    if (createdRevisionItemId) {
      // externalIntegrationMapping.entityId is polymorphic TEXT with NO FK, so
      // deleting the item does NOT cascade its onshape mapping row — delete it
      // explicitly to avoid orphaned/duplicate mappings on a later re-run.
      await serviceClient
        .from("externalIntegrationMapping")
        .delete()
        .eq("entityType", "item")
        .eq("entityId", createdRevisionItemId)
        .eq("integration", "onshape")
        .eq("companyId", companyId)
        .then(
          () => {},
          (e) => console.error("onshape rollback cleanup failed (mapping)", e)
        );
      await deleteItem(serviceClient, createdRevisionItemId).catch((e) =>
        console.error("onshape rollback cleanup failed (revision item)", e)
      );
    }
    if (createdChangeOrderItemId) {
      await deleteChangeOrderItem(
        serviceClient,
        createdChangeOrderItemId
      ).catch((e) =>
        console.error("onshape rollback cleanup failed (changeOrderItem)", e)
      );
    }
    if (createdCoUuid) {
      await deleteChangeOrder(serviceClient, createdCoUuid).catch((e) =>
        console.error("onshape rollback cleanup failed (changeOrder)", e)
      );
    }
    if (createdBaseItemId) {
      await deleteItem(serviceClient, createdBaseItemId).catch((e) =>
        console.error("onshape rollback cleanup failed (base item)", e)
      );
    }
  };

  let seedItemId: string;
  let created = false;

  if (family.data.kind === "alreadySynced") {
    // Idempotent re-run: this exact OnShape revisionId already maps to a Carbon
    // revision item. SHORT-CIRCUIT — return the EXISTING revision + its open
    // change order. Falling through to createPendingRevision + writeRevisionMapping
    // would delete-by-newItemId (matching nothing) then re-insert the same
    // (integration, externalId, entityType) mapping row → 23505 → full rollback.
    const existing = await resolveAlreadySyncedResult(serviceClient, {
      existingItemId: family.data.itemId,
      bomRows,
      companyId,
      userId
    });
    if (existing.error || !existing.data) {
      return {
        data: null,
        error: existing.error ?? {
          message: "Failed to resolve already-synced revision"
        }
      };
    }
    return { data: existing.data, error: null };
  } else if (family.data.kind === "family") {
    seedItemId = family.data.itemId;
  } else {
    const base = await createBaseItem(serviceClient, {
      object,
      companyId,
      userId
    });
    if (base.error || !base.data) {
      return {
        data: null,
        error: base.error ?? { message: "Failed to create base item" }
      };
    }
    createdBaseItemId = base.data.id;
    seedItemId = base.data.id;
    created = true;
  }

  // Open/attach a Draft CO.
  const co = await openOrAttachDraftCO(serviceClient, {
    itemId: seedItemId,
    object,
    companyId,
    userId
  });
  if (co.error || !co.data) {
    await rollback();
    return {
      data: null,
      error: co.error ?? { message: "Failed to open change order" }
    };
  }
  if (!co.data.attached) {
    createdCoUuid = co.data.id;
  }

  // Task 10 — add the affected item, create the pending revision, resolve mm.
  // ATTACH reuses the pre-existing changeOrderItem (openOrAttachDraftCO already
  // SELECTed it and rejected any row with a non-null pendingItemId), so we must
  // NOT insert — that would violate UNIQUE(changeOrderId, itemId). Only the
  // freshly-created CO branch inserts the line.
  let changeOrderItemId: string;
  if (co.data.attached) {
    if (!co.data.changeOrderItemId) {
      await rollback();
      return {
        data: null,
        error: { message: "Failed to resolve existing change order item" }
      };
    }
    changeOrderItemId = co.data.changeOrderItemId;
  } else {
    const cItem = await addChangeOrderItem(serviceClient, {
      changeOrderId: co.data.id,
      itemId: seedItemId,
      companyId,
      createdBy: userId
    });
    if (cItem.error || !cItem.data) {
      await rollback();
      return {
        data: null,
        error: {
          message: cItem.error?.message ?? "Failed to add change order item"
        }
      };
    }
    createdChangeOrderItemId = cItem.data.id;
    changeOrderItemId = cItem.data.id;
  }

  const pending = await createPendingRevision(serviceClient, {
    changeOrderId: co.data.id,
    changeOrderItemId,
    itemId: seedItemId,
    userId,
    companyId
  });
  if (pending.error || !pending.data) {
    await rollback();
    return {
      data: null,
      error: pending.error ?? { message: "Failed to create pending revision" }
    };
  }
  createdRevisionItemId = pending.data.id;
  const newItemId = pending.data.id;
  const revision = pending.data.revision;

  // createPendingRevision returns { id, revision } but NOT the makeMethodId
  // (FLAG 5). Resolve the new revision's Draft makeMethod via getMakeMethods.
  const mms = await getMakeMethods(serviceClient, newItemId, companyId);
  if (mms.error) {
    await rollback();
    return { data: null, error: { message: mms.error.message } };
  }
  // FAIL-CLOSED: require a Draft make method. Do NOT fall back to mms.data[0] —
  // that could be an Active method, and `sync` would then fork/overwrite the
  // wrong (released) method instead of writing the in-place Draft.
  const draft = mms.data?.find((m) => m.status === "Draft") ?? null;
  if (!draft) {
    await rollback();
    return {
      data: null,
      error: {
        message: `No Draft make method found for the new revision ${newItemId}`
      }
    };
  }
  const makeMethodId = draft.id;

  // Task 13 — load the BOM into the new revision's Draft makeMethod via `sync`.
  const load = await loadBomIntoRevision(serviceClient, {
    makeMethodId,
    rows: bomRows,
    companyId,
    userId
  });
  if (load.error) {
    await rollback();
    return { data: null, error: load.error };
  }

  // Self-review #1 — stale inherited STEP model. createPendingRevision/createRevision
  // CLONES the seed revision's item, INCLUDING its modelUploadId, so the new
  // revision initially points at the PREVIOUS revision's STEP. The geometry pull
  // below only overwrites item.modelUploadId on SUCCESS; a skipped/timed-out/failed
  // pull would otherwise leave the new revision showing the OLD geometry. Null it
  // out NOW (only when we are actually going to attempt a geometry pull, i.e. an
  // onshapeClient is present) so the slot is empty unless the pull repopulates it.
  if (onshapeClient) {
    const clearModel = await serviceClient
      .from("item")
      .update({ modelUploadId: null })
      .eq("id", newItemId)
      .eq("companyId", companyId);
    if (clearModel.error) {
      await rollback();
      return { data: null, error: { message: clearModel.error.message } };
    }
  }

  // Self-review #2(a) — write the idempotency mapping row IMMEDIATELY (BEFORE the
  // slow drawing/geometry pulls). If the request is killed mid-pull, this row has
  // already landed so a retry hits the alreadySynced short-circuit instead of
  // creating a DUPLICATE revision/CO. The drawingPath/drawingRevisionLabel are
  // PATCHED in afterward (self-review #2(c)). We pass the caller's extraMetadata
  // as-is here (NOT mutated — self-review #3).
  const mapping = await writeRevisionMapping(serviceClient, {
    newItemId,
    object,
    companyId
  });
  if (mapping.error) {
    await rollback();
    return { data: null, error: mapping.error };
  }

  // Task 25 — pull the controlled DRAWING PDF + STEP geometry SSOT.
  //
  // These run AFTER the BOM is loaded + the idempotency mapping is written (the
  // BOM is the core deliverable) and their failures are NON-FATAL: a
  // missing/failed drawing or geometry must NOT roll back the whole import. We
  // log + collect a per-object warning and carry on. Self-review #2(b): the two
  // independent pulls run CONCURRENTLY via Promise.allSettled (halves wall-clock,
  // ~80s -> ~40s). The resolved drawing fields are PATCHED into the existing
  // mapping row below (self-review #2(c)) so the orchestrator stays the single
  // writer of the `onshape` mapping row. The caller's object is never mutated
  // (self-review #3) — drawing fields collect into a LOCAL patch object.
  const warnings: string[] = [];
  const metadataPatch: Record<string, unknown> = {};
  if (onshapeClient) {
    const db = getDatabaseClient();

    const [drawingSettled, geometrySettled] = await Promise.allSettled([
      // Drawing PDF → storage; resolve drawingPath/drawingRevisionLabel for the
      // mapping-metadata patch. The helper swallows non-fatal errors / nulls.
      pullDrawingForRevision(serviceClient, onshapeClient, {
        documentId: object.did,
        sourceVid: object.sourceVid,
        configuration: object.fullConfiguration ?? undefined,
        itemId: newItemId,
        companyId,
        userId,
        partNumber: object.partNumber
      }),
      // STEP geometry → modelUpload (sets item.modelUploadId on success). Element
      // type routes assembly vs part-studio translation; default ASSEMBLY.
      pullGeometryForRevision(serviceClient, db, onshapeClient, {
        documentId: object.did,
        sourceVid: object.sourceVid,
        elementId: object.eid,
        elementType: object.elementType ?? OnshapeElementType.ASSEMBLY,
        configuration: object.fullConfiguration ?? undefined,
        readableIdWithRevision: getReadableIdWithRevision(
          object.partNumber,
          revision
        ),
        itemId: newItemId,
        companyId,
        userId
      })
    ]);

    // Drawing result.
    if (drawingSettled.status === "fulfilled") {
      const drawing = drawingSettled.value;
      if (drawing.data) {
        if (drawing.data.drawingPath || drawing.data.drawingRevisionLabel) {
          metadataPatch.drawingPath = drawing.data.drawingPath;
          metadataPatch.drawingRevisionLabel =
            drawing.data.drawingRevisionLabel;
        }
        // Track the uploaded PDF object so a later rollback removes it.
        if (drawing.data.drawingPath) {
          createdStoragePaths.push(drawing.data.drawingPath);
        }
        if (!drawing.data.drawingPath && !drawing.timedOut) {
          warnings.push("No controlled drawing was pulled from OnShape");
        }
      }
      if (drawing.warning) {
        warnings.push(drawing.warning);
      }
      // Non-fatal timeout: the OnShape translation has not finished; re-sync later.
      if (drawing.timedOut) {
        warnings.push(
          "OnShape drawing still processing — re-sync later to attach the controlled PDF"
        );
      }
    } else {
      console.error("OnShape: drawing pull threw", drawingSettled.reason);
      warnings.push("Failed to pull the controlled drawing from OnShape");
    }

    // Geometry result. uploadOnshapeModelUpload(setItemModelUpload:true) has
    // already set item.modelUploadId on success; on skip/timeout/fail it stays
    // null (self-review #1 — never stale).
    if (geometrySettled.status === "fulfilled") {
      const geometry = geometrySettled.value;
      if (geometry.error) {
        console.error("OnShape: geometry pull failed", geometry.error);
        warnings.push(
          `Failed to pull STEP geometry from OnShape: ${geometry.error.message}`
        );
      } else if (geometry.data) {
        // Track the modelUpload row + storage object so rollback can clean both.
        createdModelUploadId = geometry.data.modelUploadId;
        createdStoragePaths.push(geometry.data.modelPath);
      }
      if (geometry.timedOut) {
        warnings.push(
          "OnShape geometry still processing — re-sync later to attach the STEP model"
        );
      }
    } else {
      console.error("OnShape: geometry pull threw", geometrySettled.reason);
      warnings.push("Failed to pull STEP geometry from OnShape");
    }

    // Self-review #2(c) — PATCH the existing mapping row with the resolved
    // drawing fields (merge, never re-insert). Non-fatal: the ECO + BOM + the
    // initial mapping have already landed; a failed patch only loses the drawing
    // pointer, which the operator can recover by re-syncing.
    if (Object.keys(metadataPatch).length > 0) {
      const patched = await patchRevisionMappingMetadata(serviceClient, {
        newItemId,
        companyId,
        patch: metadataPatch
      });
      if (patched.error) {
        console.error(
          "OnShape: failed to patch mapping metadata",
          patched.error
        );
        warnings.push(
          "Imported, but failed to record the controlled drawing pointer"
        );
      }
    }
  }

  return {
    data: {
      itemId: newItemId,
      changeOrderId: co.data.id, // CO uuid
      changeOrderReadableId: co.data.changeOrderId,
      changeOrderItemId,
      makeMethodId,
      revision,
      created,
      warnings: warnings.length > 0 ? warnings : undefined
    },
    error: null
  };
}

// NOTE (self-review #9): v1 config handling is per-released-object — each
// configuration has a unique part number and is imported individually from the
// picker via importReleasedRevision → importOnshapeReleasedObject. The
// batch release-package fan-out (one OnShape release → many objects in one pass)
// is deferred to Increment 3; the previous dead importOnshapeRelease() helper was
// never wired to a route and silently skipped the SSOT pulls, so it was removed.

// -----------------------------------------------------------------------------
// Task 15 — single-object thin wrapper for the import route (Area B contract).
//
// SINGLE service-role client (verifier correction — dual-client signature
// dropped). Builds the OnshapeReleasedObject by fetching revision detail +
// flattening the multi-level BOM through getOnshapeClient, then delegates to
// importOnshapeReleasedObject and returns the CO uuid for the route.
// -----------------------------------------------------------------------------

export async function importReleasedRevision(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    userId: string;
    documentId: string;
    sourceVid: string;
    revisionId: string;
    partNumber: string;
    // OnShape literal revision label from the form (e.g. "B"). Used as a FALLBACK
    // for the carbon revision label when getRevisionDetail.revision is absent —
    // detail.revision is unverified live (self-review #7).
    revisionLabel?: string | null;
    // Configuration carried in from the form. Used as a FALLBACK when
    // getRevisionDetail does not echo the configuration back — otherwise a
    // configured object silently imports the DEFAULT BOM.
    configurationId?: string | null;
    fullConfiguration?: string | null;
  }
): Promise<{
  data: { changeOrderId: string; warnings?: string[] } | null;
  error: { message: string } | null;
}> {
  const { companyId, userId, documentId, sourceVid, revisionId, partNumber } =
    input;

  if (!partNumber?.trim()) {
    return {
      data: null,
      error: {
        message: "OnShape object has no Part Number — release it first"
      }
    };
  }

  const onshape = await getOnshapeClient(client, companyId, userId);
  if (onshape.error || !onshape.client) {
    return {
      data: null,
      error: { message: onshape.error ?? "Onshape integration not found" }
    };
  }

  // Fetch the revision detail (sourceVid + configuration + elementId).
  // VERIFY-LIVE: getRevisionDetail path and the populated fields (versionId,
  // elementId, configurationId, fullConfiguration) are Glassworks-documented but
  // unconfirmed in this repo — diff against a live response.
  let detail;
  try {
    detail = await onshape.client.getRevisionDetail(revisionId);
  } catch (err) {
    return {
      data: null,
      error: {
        message:
          err instanceof Error
            ? err.message
            : "Failed to fetch OnShape revision detail"
      }
    };
  }

  const eid = detail.elementId;
  const versionId = detail.versionId ?? sourceVid;
  // Use the form-supplied config as a FALLBACK when getRevisionDetail does not
  // echo it back — otherwise a configured object silently imports the DEFAULT
  // BOM. `fullConfiguration` is the value getMultiLevelBomForRevision pins to.
  const fullConfiguration =
    detail.fullConfiguration ?? input.fullConfiguration ?? undefined;
  const configurationId =
    detail.configurationId ?? input.configurationId ?? undefined;
  const configuration = fullConfiguration;

  if (!eid) {
    return {
      data: null,
      error: { message: "OnShape revision has no element id" }
    };
  }

  // Fetch + flatten the multi-level BOM pinned to the revision's version +
  // configuration. The flatten mirrors the BOM route (headers->rows map) so the
  // BomRow shape stays in lockstep.
  // VERIFY-LIVE: getMultiLevelBomForRevision returns the same { headers, rows }
  // shape as getBillOfMaterials — confirm against a live response.
  let bomResponse: any;
  try {
    bomResponse = await onshape.client.getMultiLevelBomForRevision(
      documentId,
      versionId,
      eid,
      configuration
    );
  } catch (err) {
    return {
      data: null,
      error: {
        message:
          err instanceof Error ? err.message : "Failed to fetch OnShape BOM"
      }
    };
  }

  const bomRows = flattenBomResponse(bomResponse);

  // Resolve the geometry element type for the STEP translation (Task 24). The
  // revision detail's elementType is "ASSEMBLY"/"PARTSTUDIO" (or absent); map it
  // onto the enum, defaulting to ASSEMBLY (released objects are most often
  // assemblies). VERIFY-LIVE: the elementType value on the revision payload.
  const elementType: OnshapeElementType =
    typeof detail.elementType === "string" &&
    detail.elementType.toUpperCase().includes("PART")
      ? OnshapeElementType.PART_STUDIO
      : OnshapeElementType.ASSEMBLY;

  // Self-review #7 — revisionLabel fallback. detail.revision is Glassworks-
  // documented but UNVERIFIED live; if it is absent, fall back to the OnShape
  // literal label posted by the modal (input.revisionLabel), then the revisionId
  // as a last resort so the label is never empty.
  const revisionLabel =
    (detail.revision && String(detail.revision)) ||
    input.revisionLabel ||
    revisionId;

  const object: OnshapeReleasedObject = {
    partNumber: partNumber.trim(),
    revisionLabel,
    name: detail.name ?? partNumber.trim(),
    description: detail.description,
    revisionId,
    did: documentId,
    sourceVid: versionId,
    eid,
    elementType,
    configurationId: configurationId ?? null,
    fullConfiguration: fullConfiguration ?? null,
    bomRows
  };

  const result = await importOnshapeReleasedObject(client, {
    object,
    companyId,
    userId,
    // Thread the already-built OnShape client so the orchestrator can pull the
    // controlled drawing + STEP geometry SSOT (Task 25).
    onshapeClient: onshape.client
  });

  if (result.error || !result.data) {
    return {
      data: null,
      error: result.error ?? { message: "Failed to import OnShape revision" }
    };
  }

  // Thread the per-object NON-FATAL warnings (skipped/timed-out drawing or
  // geometry pull) through to the route so the modal can surface them as a
  // toast — the ECO + BOM still landed (Task 26 · surface warnings).
  return {
    data: {
      changeOrderId: result.data.changeOrderId,
      warnings: result.data.warnings
    },
    error: null
  };
}

// -----------------------------------------------------------------------------
// BOM flatten — mirrors integrations.onshape.d.$did.v.$vid.e.$eid.bom.ts so the
// emitted BomRow matches what the rest of the orchestrator expects. Quantity is
// kept as the raw OnShape value (string) and coerced in toSyncPayloadRows.
// -----------------------------------------------------------------------------

function flattenBomResponse(response: any): BomRow[] {
  if (
    !response ||
    !("headers" in response) ||
    !Array.isArray(response.headers) ||
    !("rows" in response) ||
    !Array.isArray(response.rows)
  ) {
    return [];
  }

  const headers = response.headers as { id: string; name: string }[];
  const rows = response.rows as {
    headerIdToValue: Record<string, any>;
  }[];

  return rows.map((row) => {
    const data: Record<string, any> = {};
    headers.forEach((header) => {
      if (header.name === "Material") {
        data[header.name] = row.headerIdToValue[header.id]?.displayName || "";
      } else {
        data[header.name] = row.headerIdToValue[header.id] || "";
      }
    });

    const partNumber = data["Part number"] || data["Name"];
    const revision = data["Revision"];
    const readableIdWithRevision = getReadableIdWithRevision(
      partNumber,
      revision
    );

    const purchased = data["Purchasing Level"] === "Purchased";
    const replenishmentSystem: ReplenishmentSystem = purchased ? "Buy" : "Make";
    const defaultMethodType: DefaultMethodType = purchased
      ? "Pull from Inventory"
      : "Make to Order";

    return {
      index: data["Item"] ?? "",
      readableId: data["Part number"],
      revision: data["Revision"],
      readableIdWithRevision,
      name: data["Name"] || data["Description"] || data["Part number"] || "",
      replenishmentSystem,
      defaultMethodType,
      quantity: data["Quantity"],
      level: data["Item"]?.toString().split(".").length ?? 1,
      data
    };
  });
}
