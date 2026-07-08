import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trigger } from "@carbon/lib/trigger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

// Push fetched Onshape bytes (STEP geometry) into the private `models/` bucket,
// create a `modelUpload` row, and (optionally) atomically link it onto
// item.modelUploadId.
//
// Storage layout MUST stay `{companyId}/models/<id>.<ext>` so the existing
// `private` bucket RLS (folder [0]=companyId, [2]='models') keeps applying.
//
// The Storage upload is a separate, non-transactional HTTP request: we upload
// BEFORE the DB writes and remove the object if they fail. The modelUpload INSERT
// and the item.modelUploadId UPDATE are ONE Kysely transaction, so a "half-link"
// can never persist. Kysely bypasses RLS, so every write is scoped by companyId.

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
    // same transaction (geometry SSOT). When false, the row stands alone (the
    // PDF path stores its location in mapping metadata instead of on the item).
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
          err instanceof Error ? err.message : "Failed to record model upload"
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
