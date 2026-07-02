import type { Database, Json } from "@carbon/database";
import type { OnshapeClient } from "@carbon/ee/onshape";
import { getOnshapeClient, OnshapeElementType } from "@carbon/ee/onshape";
import { trigger } from "@carbon/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getReadableIdWithRevision } from "~/utils/string";
import {
  addChangeOrderItem,
  createPendingRevision,
  getMakeMethods,
  getOpenChangeOrderForItem,
  insertChangeOrder
} from "../items/items.service";
import {
  flattenBomResponse,
  loadBomIntoRevision,
  resolveChildren
} from "./onshape/bom-load";
import {
  newImportArtifacts,
  rollbackImport
} from "./onshape/onshape-import.rollback";
import type {
  OnshapeImportResult,
  OnshapeReleasedObject
} from "./onshape/onshape-import.types";
import {
  createBaseItem,
  resolveItemFamily
} from "./onshape/resolve-item-family";

// Onshape import orchestrator. A Supabase-client (PostgREST) pipeline with
// explicit rollback-on-failure, NOT a single Kysely transaction: every step
// mixes Supabase writes with edge functions (`get-method`, `sync`) that can't
// enroll in a Kysely tx. One service-role client is threaded through all
// reads/writes and the `sync` invoke; auth is enforced at the route.
//
// Drawing PDF + STEP geometry are pulled out-of-band: after the revision mapping
// is written this enqueues the `onshape-file-pull` job and returns fast (Onshape
// translations can take minutes).

type OpenOrAttachResult = {
  id: string; // CO uuid
  changeOrderId: string; // human-readable, e.g. CO-000001
  attached: boolean; // true when an existing open CO was attached (not created)
  // On the ATTACH branch this is the pre-existing changeOrderItem — the caller
  // must NOT re-insert (would violate UNIQUE(changeOrderId, itemId)). null on
  // the CREATE branch, where the caller inserts it.
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

  // getOpenChangeOrderForItem returns the human changeOrderId, not the uuid — so
  // on a hit we re-fetch the uuid and attach (don't create).
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

    // The open CO already has a changeOrderItem for this item — reuse it;
    // inserting would violate UNIQUE(changeOrderId, itemId).
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
    // Never stack a second pending revision on the same open CO line — the
    // in-flight revision must be released/cancelled before re-importing.
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

  // No open CO — create a Draft one (sourceId = the Onshape revisionId).
  const created = await insertChangeOrder(client, {
    name: `Onshape import — ${object.partNumber} Rev ${object.revisionLabel}`,
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

// Write the revision-level externalIntegrationMapping via delete-then-insert:
// the (integration, externalId, entityType, companyId) unique index is PARTIAL,
// which PostgREST can't use as an upsert conflict target.
async function writeRevisionMapping(
  client: SupabaseClient<Database>,
  args: {
    newItemId: string;
    object: OnshapeReleasedObject;
    companyId: string;
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
    ...(args.extraMetadata ?? object.extraMetadata ?? {})
  } as Json;

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

  // entityId is the new revision item, so this row doesn't collide with the
  // per-line `onshapeData` mapping `sync` writes — both are intentionally kept.
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

// Idempotent short-circuit for a revisionId that already maps to a Carbon
// revision: return the existing revision item + its open change order.
async function resolveAlreadySyncedResult(
  client: SupabaseClient<Database>,
  args: {
    existingItemId: string;
    companyId: string;
    userId: string;
  }
): Promise<{
  data: OnshapeImportResult | null;
  error: { message: string } | null;
}> {
  const { existingItemId, companyId } = args;

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

  // The revision item is referenced by a changeOrderItem as either the pending
  // revision (pendingItemId) or the source item (itemId).
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
// Per-object orchestration with rollback.
// -----------------------------------------------------------------------------

export async function importOnshapeReleasedObject(
  serviceClient: SupabaseClient<Database>,
  args: {
    object: OnshapeReleasedObject;
    companyId: string;
    userId: string;
    // When omitted, the drawing/geometry pull is skipped.
    onshapeClient?: OnshapeClient;
  }
): Promise<{
  data: OnshapeImportResult | null;
  error: { message: string } | null;
}> {
  const { object, companyId, userId, onshapeClient } = args;

  if (!object.partNumber?.trim()) {
    return {
      data: null,
      error: {
        message: "Onshape object has no Part Number — release it first"
      }
    };
  }

  // Pre-resolve child ids + phantom flags (returns new rows; object.bomRows is
  // not mutated).
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
  const artifacts = newImportArtifacts();

  // Single rollback+return path. Every step failure below funnels through this
  // so the ordered teardown can never be forgotten as new steps are added.
  const bail = async (
    err: { message: string } | null | undefined,
    fallback: string
  ) => {
    await rollbackImport(serviceClient, artifacts, companyId);
    return { data: null, error: err ?? { message: fallback } };
  };

  let seedItemId: string;
  let created = false;

  if (family.data.kind === "alreadySynced") {
    // Idempotent re-run — return the existing revision + its open CO rather than
    // re-creating it.
    const existing = await resolveAlreadySyncedResult(serviceClient, {
      existingItemId: family.data.itemId,
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
    artifacts.baseItemId = base.data.id;
    seedItemId = base.data.id;
    created = true;
  }

  const co = await openOrAttachDraftCO(serviceClient, {
    itemId: seedItemId,
    object,
    companyId,
    userId
  });
  if (co.error || !co.data) {
    return bail(co.error, "Failed to open change order");
  }
  if (!co.data.attached) {
    artifacts.coUuid = co.data.id;
  }

  // ATTACH reuses the pre-existing changeOrderItem; only the freshly-created CO
  // branch inserts the line.
  let changeOrderItemId: string;
  if (co.data.attached) {
    if (!co.data.changeOrderItemId) {
      return bail(null, "Failed to resolve existing change order item");
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
      return bail(cItem.error, "Failed to add change order item");
    }
    artifacts.changeOrderItemId = cItem.data.id;
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
    return bail(pending.error, "Failed to create pending revision");
  }
  artifacts.revisionItemId = pending.data.id;
  const newItemId = pending.data.id;
  const revision = pending.data.revision;

  const mms = await getMakeMethods(serviceClient, newItemId, companyId);
  if (mms.error) {
    return bail(mms.error, "Failed to load make methods");
  }
  // Fail closed: require a Draft make method — don't fall back to mms.data[0],
  // which could be Active, causing `sync` to fork/overwrite the released method.
  const draft = mms.data?.find((m) => m.status === "Draft") ?? null;
  if (!draft) {
    return bail(
      null,
      `No Draft make method found for the new revision ${newItemId}`
    );
  }
  const makeMethodId = draft.id;

  const load = await loadBomIntoRevision(serviceClient, {
    makeMethodId,
    rows: bomRows,
    companyId,
    userId
  });
  if (load.error) {
    return bail(load.error, "Failed to load BOM into revision");
  }

  // createRevision clones the seed item's modelUploadId, so the new revision
  // starts pointing at the previous revision's STEP. Clear it before the
  // geometry pull (which only repopulates on success) so a stale model can't
  // survive a failed/absent pull.
  if (onshapeClient) {
    const clearModel = await serviceClient
      .from("item")
      .update({ modelUploadId: null })
      .eq("id", newItemId)
      .eq("companyId", companyId);
    if (clearModel.error) {
      return bail(clearModel.error, "Failed to clear inherited model");
    }
  }

  // Write the idempotency mapping BEFORE enqueuing the pulls, so a retry hits
  // the already-synced short-circuit instead of duplicating the revision/CO.
  const mapping = await writeRevisionMapping(serviceClient, {
    newItemId,
    object,
    companyId
  });
  if (mapping.error) {
    return bail(mapping.error, "Failed to write revision mapping");
  }

  // Enqueue the drawing/geometry pulls out-of-band (translations can take
  // minutes). Fire-and-forget: a trigger failure must not fail the import — the
  // CO + BOM already landed and a later re-sync can attach the files.
  if (onshapeClient) {
    try {
      await trigger("onshape-file-pull", {
        companyId,
        userId,
        revisionItemId: newItemId,
        documentId: object.did,
        sourceVid: object.sourceVid,
        elementId: object.eid,
        elementType: object.elementType ?? OnshapeElementType.ASSEMBLY,
        configuration: object.fullConfiguration ?? undefined,
        partNumber: object.partNumber,
        readableIdWithRevision: getReadableIdWithRevision(
          object.partNumber,
          revision
        )
      });
    } catch (err) {
      console.error("Onshape: failed to enqueue file-pull job", err);
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
      warnings: undefined
    },
    error: null
  };
}

// Route entry point: fetch the revision detail + flatten the multi-level BOM,
// then delegate to importOnshapeReleasedObject and return the CO uuid.
export async function importReleasedRevision(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    userId: string;
    documentId: string;
    sourceVid: string;
    revisionId: string;
    partNumber: string;
    revisionLabel?: string | null;
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
        message: "Onshape object has no Part Number — release it first"
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
            : "Failed to fetch Onshape revision detail"
      }
    };
  }

  const eid = detail.elementId;
  const versionId = detail.versionId ?? sourceVid;
  // Fall back to the form-supplied config when getRevisionDetail doesn't echo it
  // — otherwise a configured object silently imports the default BOM.
  const fullConfiguration =
    detail.fullConfiguration ?? input.fullConfiguration ?? undefined;
  const configurationId =
    detail.configurationId ?? input.configurationId ?? undefined;
  const configuration = fullConfiguration;

  if (!eid) {
    return {
      data: null,
      error: { message: "Onshape revision has no element id" }
    };
  }

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
          err instanceof Error ? err.message : "Failed to fetch Onshape BOM"
      }
    };
  }

  const bomRows = flattenBomResponse(bomResponse);

  // Map the geometry element type for the STEP translation, defaulting to
  // ASSEMBLY (released objects are most often assemblies).
  const elementType: OnshapeElementType =
    typeof detail.elementType === "string" &&
    detail.elementType.toUpperCase().includes("PART")
      ? OnshapeElementType.PART_STUDIO
      : OnshapeElementType.ASSEMBLY;

  // Fall back through the modal-posted label, then the revisionId, so the label
  // is never empty.
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
    onshapeClient: onshape.client
  });

  if (result.error || !result.data) {
    return {
      data: null,
      error: result.error ?? { message: "Failed to import Onshape revision" }
    };
  }

  return {
    data: {
      changeOrderId: result.data.changeOrderId,
      warnings: result.data.warnings
    },
    error: null
  };
}
