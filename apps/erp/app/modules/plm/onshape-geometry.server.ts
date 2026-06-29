import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { OnshapeClient, OnshapeElementType } from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";

import { uploadOnshapeModelUpload } from "./onshape-model.server";
import { isTranslationTimeout, REQUEST_SAFE_POLL } from "./onshape-poll.server";

// =============================================================================
// Task 24 — pull STEP geometry for the new revision → per-revision modelUpload
// (sets item.modelUploadId).
//
// Flow: translate the part/assembly geometry to STEP (routed by element type) →
// poll → download the external-data blob → uploadOnshapeModelUpload with
// setItemModelUpload:true. Setting item.modelUploadId makes the new revision's
// geometry render automatically via CadModel on part details.
//
// NON-FATAL: a translation/timeout failure returns { error } to the caller,
// which logs a warning and continues (the BOM is the core deliverable).
//
// FLAG (invocation context): the bounded poll blocks; inside a synchronous
// React Router action this risks a request timeout for large assemblies. The
// orchestrator wiring (Task 25) calls this AFTER the BOM is loaded so a slow
// geometry pull never blocks the ECO; gate behind an Inngest job if the
// entrypoint ever runs in an RR action. Open decision — note in the PR.
// =============================================================================

export async function pullGeometryForRevision(
  serviceClient: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  onshapeClient: OnshapeClient,
  args: {
    documentId: string;
    sourceVid: string;
    elementId: string;
    elementType: OnshapeElementType;
    configuration?: string;
    readableIdWithRevision: string;
    itemId: string;
    companyId: string;
    userId: string;
  }
): Promise<{
  data: { modelUploadId: string; modelPath: string } | null;
  error: { message: string } | null;
  // True when the STEP translation did not finish within the request-safe poll
  // budget — NON-FATAL (re-sync later), distinct from a hard failure.
  timedOut?: boolean;
}> {
  const {
    documentId,
    sourceVid,
    elementId,
    elementType,
    configuration,
    readableIdWithRevision,
    itemId,
    companyId,
    userId
  } = args;

  // VERIFY-LIVE/TODO(job): the poll blocks the request; production must move this
  // pull to a background job (Inngest). Until then we use a request-safe budget
  // (REQUEST_SAFE_POLL ≈40s) and treat a timeout as a re-sync-later signal.
  let stepBytes: Uint8Array;
  try {
    const translation = await onshapeClient.translateGeometryToStep(
      documentId,
      sourceVid,
      elementId,
      elementType,
      configuration ? { configuration } : {}
    );
    stepBytes = await onshapeClient.downloadTranslationResult(
      documentId,
      translation,
      REQUEST_SAFE_POLL
    );
  } catch (err) {
    // A poll-budget timeout is NON-FATAL: the STEP export is still processing on
    // OnShape's side. Signal `timedOut` (no hard error) so the orchestrator
    // collects a "re-sync later" warning instead of rolling back the import.
    if (isTranslationTimeout(err)) {
      console.warn(
        "OnShape: STEP geometry translation still processing (poll timed out)"
      );
      return { data: null, error: null, timedOut: true };
    }
    return {
      data: null,
      error: {
        message:
          err instanceof Error
            ? err.message
            : "Failed to translate/download OnShape STEP geometry"
      }
    };
  }

  // Upload + atomically link onto item.modelUploadId (Task 22).
  return uploadOnshapeModelUpload(serviceClient, db, {
    companyId,
    itemId,
    name: `${readableIdWithRevision}.step`,
    bytes: stepBytes,
    extension: "step",
    userId,
    setItemModelUpload: true,
    contentType: "application/step"
  });
}
