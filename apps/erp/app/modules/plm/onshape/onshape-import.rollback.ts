import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deleteChangeOrder,
  deleteChangeOrderItem,
  deleteItem
} from "../../items/items.service";

// =============================================================================
// Ordered teardown for a partially-completed Onshape import.
// The orchestrator fills this "created artifacts" object as it progresses; on
// any step failure it calls rollbackImport to delete ONLY what this import
// created, in the safe order:
//   externalIntegrationMapping → revision item → changeOrderItem → changeOrder
//   → base item.
// The controlled-drawing PDF + STEP geometry (storage blobs + modelUpload row)
// are created out-of-band by the `onshape-file-pull` job, which owns their
// lifecycle — they are intentionally NOT tracked or torn down here.
// Best-effort throughout; secondary failures are logged, never thrown.
// =============================================================================

export type ImportArtifacts = {
  baseItemId: string | null;
  coUuid: string | null;
  changeOrderItemId: string | null;
  revisionItemId: string | null;
};

export function newImportArtifacts(): ImportArtifacts {
  return {
    baseItemId: null,
    coUuid: null,
    changeOrderItemId: null,
    revisionItemId: null
  };
}

export async function rollbackImport(
  serviceClient: SupabaseClient<Database>,
  artifacts: ImportArtifacts,
  companyId: string
): Promise<void> {
  if (artifacts.revisionItemId) {
    // externalIntegrationMapping.entityId is polymorphic TEXT with NO FK, so
    // deleting the item does NOT cascade its onshape mapping row — delete it
    // explicitly to avoid orphaned/duplicate mappings on a later re-run.
    await serviceClient
      .from("externalIntegrationMapping")
      .delete()
      .eq("entityType", "item")
      .eq("entityId", artifacts.revisionItemId)
      .eq("integration", "onshape")
      .eq("companyId", companyId)
      .then(undefined, (e) =>
        console.error("onshape rollback cleanup failed (mapping)", e)
      );
    await deleteItem(serviceClient, artifacts.revisionItemId).catch((e) =>
      console.error("onshape rollback cleanup failed (revision item)", e)
    );
  }
  if (artifacts.changeOrderItemId) {
    await deleteChangeOrderItem(
      serviceClient,
      artifacts.changeOrderItemId
    ).catch((e) =>
      console.error("onshape rollback cleanup failed (changeOrderItem)", e)
    );
  }
  if (artifacts.coUuid) {
    await deleteChangeOrder(serviceClient, artifacts.coUuid).catch((e) =>
      console.error("onshape rollback cleanup failed (changeOrder)", e)
    );
  }
  if (artifacts.baseItemId) {
    await deleteItem(serviceClient, artifacts.baseItemId).catch((e) =>
      console.error("onshape rollback cleanup failed (base item)", e)
    );
  }
}
