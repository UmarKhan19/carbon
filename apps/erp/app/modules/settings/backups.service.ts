import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

// Company backup data access. The export edge function is a thin auth boundary;
// the heavy lifting runs in the carbon/company-export inngest job. Restore is
// enqueued server-side (see backups.server.ts) and tracked via the
// externalIntegrationMapping marker (getCompanyRestoreRuns).

// A backup is the gz plus its sibling `<name>.assets/` folder of copied storage
// files. Must match `BACKUP_GZ_SUFFIX` / `backupAssetPrefix` in
// packages/jobs/src/inngest/functions/tasks/company-backup.ts.
const BACKUP_GZ_SUFFIX = ".carbon.json.gz";

function backupAssetPrefix(filePath: string) {
  const base = filePath.endsWith(BACKUP_GZ_SUFFIX)
    ? filePath.slice(0, -BACKUP_GZ_SUFFIX.length)
    : filePath;
  return `${base}.assets`;
}

/**
 * Remove every object under a prefix (recursing into folders) so a deleted
 * backup actually releases its bucket space rather than orphaning files.
 */
async function removeStoragePrefix(
  client: SupabaseClient<Database>,
  bucket: string,
  prefix: string
) {
  const { data } = await client.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (!data) return;
  const files: string[] = [];
  for (const entry of data) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      await removeStoragePrefix(client, bucket, path);
    } else {
      files.push(path);
    }
  }
  if (files.length > 0) {
    await client.storage.from(bucket).remove(files);
  }
}

export async function exportCompanyBackup(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    userId: string;
    label?: string;
    includeStorage?: "none" | "all";
  }
) {
  return client.functions.invoke("export-company", { body: args });
}

export async function listCompanyBackupExports(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.storage.from(companyId).list("exports", {
    limit: 25,
    sortBy: { column: "created_at", order: "desc" }
  });
}

export async function getCompanyBackupSignedUrl(
  client: SupabaseClient<Database>,
  companyId: string,
  filePath: string
) {
  return client.storage.from(companyId).createSignedUrl(filePath, 60 * 60);
}

export async function deleteCompanyBackupExport(
  client: SupabaseClient<Database>,
  companyId: string,
  filePath: string
) {
  // Release the backup's asset folder first, then the gz, so the bucket space
  // is fully reclaimed (the .assets/ files are the bulk of a backup).
  await removeStoragePrefix(client, companyId, backupAssetPrefix(filePath));
  return client.storage.from(companyId).remove([filePath]);
}

/**
 * Pending in-place restore runs. One marker row per restore (integration =
 * 'company-restore'), holding the pre-restore snapshot path in metadata. A row
 * exists between the restore completing and the user keeping or reverting it.
 */
export async function getCompanyRestoreRuns(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const markers = await client
    .from("externalIntegrationMapping")
    .select("entityId, metadata, createdAt")
    .eq("integration", "company-restore")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });

  if (markers.error) return { data: null, error: markers.error };

  const runs = (markers.data ?? []).map((m) => {
    const meta = (m.metadata ?? {}) as {
      restoreRunId?: string;
      status?: "running" | "ready" | "failed" | "reverting";
      rows?: number;
      label?: string | null;
      error?: string | null;
    };
    return {
      restoreRunId: meta.restoreRunId ?? m.entityId,
      status: meta.status ?? "running",
      rows: meta.rows ?? 0,
      label: meta.label ?? null,
      error: meta.error ?? null,
      startedAt: m.createdAt
    };
  });

  return { data: runs, error: null };
}
