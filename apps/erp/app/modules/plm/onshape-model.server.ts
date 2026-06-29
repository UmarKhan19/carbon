import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

// =============================================================================
// Task 22 — server-side helper to push fetched OnShape bytes (STEP geometry)
// into the private `models/` bucket + create a `modelUpload` row and (atomically)
// link it onto `item.modelUploadId`.
//
// This is the canonical server analog of the client-driven `model.upload.ts`
// route flow (which presigns + uploads from the browser then records the row).
// There is NO shared helper today — this is it.
//
// Storage layout MUST stay `{companyId}/models/<id>.<ext>` so the existing
// `private` bucket storage RLS (keyed on folder [0]=companyId, [2]='models')
// continues to apply. A bespoke `drawings/` prefix would have NO RLS — do not
// introduce one (the drawing PDF in Task 23 also lives under `models/`).
//
// Atomicity: the Supabase Storage upload is a separate HTTP request and is NOT
// transactional. We therefore order it BEFORE the DB writes and explicitly
// remove the uploaded object if the DB writes fail. The `modelUpload` INSERT and
// the `item.modelUploadId` UPDATE (when requested) are wrapped in ONE Kysely
// transaction so a "half-link" (row written, item not pointed at it — or vice
// versa) can never persist. Kysely THROWS on rollback and BYPASSES RLS, so every
// write is scoped by `companyId`. Precedent: items.service.ts
// upsertPickMethodWithShelfLife.
// =============================================================================

export async function uploadOnshapeModelUpload(
  serviceClient: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    name: string;
    bytes: ArrayBuffer | Uint8Array;
    extension: string;
    userId: string;
    // When true, atomically points `item.modelUploadId` at the new row in the
    // same transaction (geometry SSOT — Task 24). When false, the row stands
    // alone (the PDF path in Task 23 stores its location in mapping metadata
    // instead of on the item).
    setItemModelUpload: boolean;
    contentType?: string;
  }
): Promise<{
  data: { modelUploadId: string; modelPath: string } | null;
  error: { message: string } | null;
}> {
  const {
    companyId,
    itemId,
    name,
    bytes,
    extension,
    userId,
    setItemModelUpload,
    contentType
  } = args;

  const modelId = nanoid();
  const modelPath = `${companyId}/models/${modelId}.${extension}`;

  // Normalize to a Blob for Supabase Storage (works for ArrayBuffer/Uint8Array).
  const blob = new Blob([bytes as BlobPart], {
    type: contentType ?? "application/octet-stream"
  });
  const byteLength = bytes.byteLength;

  // STEP 1 — upload the object FIRST (non-transactional, separate HTTP).
  const upload = await serviceClient.storage
    .from("private")
    .upload(modelPath, blob, { upsert: true, contentType });
  if (upload.error) {
    return {
      data: null,
      error: { message: `Failed to upload model: ${upload.error.message}` }
    };
  }

  // STEP 2 — atomic DB writes (modelUpload INSERT + optional item link). On any
  // failure (Kysely throws → rollback), remove the just-uploaded object so we
  // never leave an orphaned blob with no row pointing at it.
  try {
    await db.transaction().execute(async (trx) => {
      // Self-review #6 — orphan discoverability: ideally the modelUpload row
      // would carry an `itemId` back-pointer so a mid-import crash (row written,
      // item.modelUploadId not yet set) leaves a discoverable row. The
      // modelUpload table dropped its `itemId` column
      // (migration 20240719014956_model-uploads-thumbnail.sql) and migrations
      // are out of scope here, so the ONLY association is the forward
      // item.modelUploadId pointer set below in the same transaction — the
      // INSERT + UPDATE are atomic, so a half-link can never persist. (If
      // modelUpload.itemId is ever re-added, set it here.)
      await trx
        .insertInto("modelUpload")
        .values({
          id: modelId,
          modelPath,
          name,
          size: byteLength,
          companyId,
          createdBy: userId
        })
        .execute();

      if (setItemModelUpload) {
        await trx
          .updateTable("item")
          .set({ modelUploadId: modelId })
          .where("id", "=", itemId)
          .where("companyId", "=", companyId)
          .execute();
      }
    });
  } catch (err) {
    // Best-effort cleanup of the orphaned object.
    await serviceClient.storage
      .from("private")
      .remove([modelPath])
      .then(
        () => {},
        () => {}
      );
    return {
      data: null,
      error: {
        message:
          err instanceof Error
            ? err.message
            : "Failed to record model upload"
      }
    };
  }

  // STEP 3 — fire the thumbnail job (no-ops on local per model-thumbnail.ts).
  // Non-fatal: a failure here must not undo the upload/link.
  try {
    await trigger("model-thumbnail", { companyId, modelId });
  } catch (err) {
    console.error("Failed to trigger model-thumbnail", err);
  }

  return { data: { modelUploadId: modelId, modelPath }, error: null };
}
