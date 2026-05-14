import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true
  });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const kind = url.searchParams.get("kind") ?? "all";

  // Allow empty query only when a specific kind is selected (browse mode).
  if (q.length < 2 && kind === "all") {
    return Response.json({ entities: [], activities: [] });
  }

  const wantEntities = kind === "all" || kind === "entity";
  const wantActivities = kind === "all" || kind === "activity";

  const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
  const pattern = q.length >= 2 ? `%${escaped}%` : null;

  const [entities, activities] = await Promise.all([
    wantEntities
      ? (() => {
          const query = client
            .from("trackedEntity")
            .select(
              "id, quantity, status, sourceDocument, sourceDocumentId, sourceDocumentReadableId, readableId, attributes, createdAt"
            )
            .eq("companyId", companyId)
            .order("createdAt", { ascending: false })
            .limit(50);
          if (pattern) {
            return query.or(
              `id.ilike.${pattern},sourceDocumentReadableId.ilike.${pattern},readableId.ilike.${pattern},attributes->>Batch Number.ilike.${pattern},attributes->>Serial Number.ilike.${pattern}`
            );
          }
          return query;
        })()
      : Promise.resolve({ data: [] as any[] }),
    wantActivities
      ? (() => {
          const query = client
            .from("trackedActivity")
            .select(
              "id, type, sourceDocument, sourceDocumentId, sourceDocumentReadableId, attributes, createdAt"
            )
            .eq("companyId", companyId)
            .order("createdAt", { ascending: false })
            .limit(50);
          if (pattern) {
            return query.or(
              `id.ilike.${pattern},type.ilike.${pattern},sourceDocumentReadableId.ilike.${pattern}`
            );
          }
          return query;
        })()
      : Promise.resolve({ data: [] as any[] })
  ]);

  const entityRows = (entities.data ?? []) as Array<{
    attributes: unknown;
    [key: string]: unknown;
  }>;
  const jobIds = Array.from(
    new Set(entityRows.map((e) => getJobId(e.attributes)).filter(Boolean))
  ) as string[];

  const jobsById = new Map<string, string>();
  if (jobIds.length > 0) {
    const jobs = await client.from("job").select("id, jobId").in("id", jobIds);
    for (const row of jobs.data ?? []) {
      if (row?.id && row?.jobId) jobsById.set(row.id, row.jobId);
    }
  }

  return Response.json({
    entities: entityRows.map((entity) => {
      const jobId = getJobId(entity.attributes);
      return {
        ...entity,
        jobId,
        jobReadableId: jobId ? (jobsById.get(jobId) ?? null) : null
      };
    }),
    activities: activities.data ?? []
  });
}

function getJobId(attributes: unknown): string | null {
  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  )
    return null;
  const value = (attributes as Record<string, unknown>).Job;
  return typeof value === "string" && value.trim() ? value : null;
}
