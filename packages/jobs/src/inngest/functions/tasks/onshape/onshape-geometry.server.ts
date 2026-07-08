import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { OnshapeClient, OnshapeElementType } from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";

import { uploadOnshapeModelUpload } from "./onshape-model.server";
import { BACKGROUND_POLL, isTranslationTimeout } from "./onshape-poll.server";

// Pull STEP geometry for the new revision and set item.modelUploadId (so the
// revision renders via CadModel on part details): translate (routed by element
// type) → poll → download → uploadOnshapeModelUpload. Non-fatal on translation
// timeout/failure.

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
    poll?: { maxAttempts: number; delayMs: number };
  }
): Promise<{
  data: { modelUploadId: string; modelPath: string } | null;
  error: { message: string } | null;
  // True when the STEP translation did not finish within the poll budget —
  // NON-FATAL (re-sync later), distinct from a hard failure.
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
    userId,
    poll = BACKGROUND_POLL
  } = args;

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
      poll
    );
  } catch (err) {
    // A poll-budget timeout is NON-FATAL: the STEP export is still processing on
    // Onshape's side.
    if (isTranslationTimeout(err)) {
      console.warn(
        "Onshape: STEP geometry translation still processing (poll timed out)"
      );
      return { data: null, error: null, timedOut: true };
    }
    return {
      data: null,
      error: {
        message:
          err instanceof Error
            ? err.message
            : "Failed to translate/download Onshape STEP geometry"
      }
    };
  }

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
