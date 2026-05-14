import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedTooltipText
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LuInfo, LuNetwork, LuQrCode } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { SearchLandingPage } from "~/components";
import { useUser } from "~/hooks";
import { TRACE_API } from "~/modules/inventory/ui/Traceability/constants";
import { entityStatusMeta } from "~/modules/inventory/ui/Traceability/metadata";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Traceability`,
  to: path.to.traceability,
  module: "inventory"
};

const RECENT_SEARCHES_PREFIX = "traceability-searches";

function recentSearchesKey(companyId: string): string {
  return `${RECENT_SEARCHES_PREFIX}:${companyId}`;
}

type EntityRow = {
  id: string;
  readableId: string | null;
  jobId?: string | null;
  jobReadableId?: string | null;
  sourceDocument: string | null;
  sourceDocumentId: string | null;
  sourceDocumentReadableId: string | null;
  quantity: number;
  status: string | null;
  attributes: Record<string, unknown> | null;
  createdAt: string;
};

type SearchResult = {
  entities: EntityRow[];
  activities: unknown[];
};

export default function TraceabilityRoute() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher<SearchResult>();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const storageKey = recentSearchesKey(company.id);
  const [query, setQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<EntityRow[]>([]);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      setRecentSearches([]);
      return;
    }
    let parsed: EntityRow[] = [];
    try {
      const raw = JSON.parse(stored);
      if (Array.isArray(raw)) parsed = raw;
    } catch {
      localStorage.removeItem(storageKey);
      return;
    }
    if (parsed.length === 0 || !carbon) {
      setRecentSearches(parsed);
      return;
    }
    // Show cached entries immediately, then refresh from server and drop stale.
    setRecentSearches(parsed);
    const ids = parsed.map((p) => p.id);
    carbon
      .from("trackedEntity")
      .select(
        "id, quantity, status, sourceDocument, sourceDocumentId, sourceDocumentReadableId, readableId, attributes, createdAt"
      )
      .eq("companyId", company.id)
      .in("id", ids)
      .then(async ({ data }) => {
        if (cancelled) return;
        const rows = (data ?? []) as unknown as EntityRow[];
        const jobIds = Array.from(
          new Set(
            rows
              .map((row) => getEntityJobId(row.attributes))
              .filter((id): id is string => id !== null)
          )
        );
        const jobsById = new Map<string, string>();

        if (jobIds.length > 0) {
          const jobs = await carbon
            .from("job")
            .select("id, jobId")
            .in("id", jobIds);
          if (cancelled) return;
          for (const job of jobs.data ?? []) {
            jobsById.set(job.id, job.jobId);
          }
        }

        const enrichedRows: EntityRow[] = rows.map((row): EntityRow => {
          const jobId = getEntityJobId(row.attributes);
          return {
            ...row,
            jobId,
            jobReadableId: jobId ? (jobsById.get(jobId) ?? null) : null
          };
        });
        const byId = new Map(enrichedRows.map((r) => [r.id, r]));
        const next = parsed
          .map((p) => byId.get(p.id))
          .filter((e): e is EntityRow => e !== undefined);
        setRecentSearches(next);
        if (next.length === 0) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify(next));
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey, carbon, company.id]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    debounceRef.current = window.setTimeout(() => {
      const params = new URLSearchParams({ q: trimmed, kind: "entity" });
      fetcher.load(`${TRACE_API.search}?${params.toString()}`);
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, fetcher.load]);

  const isLoading = fetcher.state !== "idle";
  const trimmed = query.trim();
  const showSearchResults = trimmed.length >= 2;
  const entities = showSearchResults ? (fetcher.data?.entities ?? []) : [];

  const recordRecent = (entity: EntityRow) => {
    const next = [
      entity,
      ...recentSearches.filter((e) => e.id !== entity.id)
    ].slice(0, 5);
    setRecentSearches(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  const openEntity = (entity: EntityRow) => {
    const entityWithJob = {
      ...entity,
      jobId: entity.jobId ?? getEntityJobId(entity.attributes)
    };
    const params = new URLSearchParams();

    recordRecent(entityWithJob);

    params.set("trackedEntityId", entity.id);

    navigate(`${path.to.traceabilityGraph}?${params.toString()}`);
  };

  return (
    <SearchLandingPage
      icon={LuNetwork}
      heading={t`Traceability`}
      description={t`Scan a label or search by item ID, tracking ID, serial number, or batch number.`}
    >
      <Command
        shouldFilter={false}
        className="rounded-md border border-border bg-background overflow-hidden"
      >
        <div className="relative">
          <CommandInput
            placeholder={t`Scan or search...`}
            value={query}
            onValueChange={setQuery}
            className="h-12 text-base pr-12"
            autoFocus
          />
          <LuQrCode className="absolute right-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground pointer-events-none" />
        </div>
        <CommandList className="h-(--cmdk-list-height) max-h-[400px] min-h-0 border-t border-border transition-[height] duration-200 ease-out [&[hidden]]:hidden">
          {showSearchResults ? (
            <>
              {entities.length > 0 ? (
                <CommandGroup
                  heading={t`Entities`}
                  className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5"
                >
                  {entities.map((entity) => (
                    <EntityRowItem
                      key={entity.id}
                      entity={entity}
                      onSelect={() => openEntity(entity)}
                    />
                  ))}
                </CommandGroup>
              ) : (
                <CommandEmpty className="text-center text-sm text-muted-foreground py-3">
                  {isLoading ? <SearchSkeleton /> : <Trans>No matches</Trans>}
                </CommandEmpty>
              )}
            </>
          ) : recentSearches.length > 0 ? (
            <CommandGroup
              heading={t`Recent`}
              className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5"
            >
              {recentSearches.map((entity) => (
                <EntityRowItem
                  key={entity.id}
                  entity={entity}
                  onSelect={() => openEntity(entity)}
                />
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </SearchLandingPage>
  );
}

function EntityRowItem({
  entity,
  onSelect
}: {
  entity: EntityRow;
  onSelect: () => void;
}) {
  const meta = entityStatusMeta(entity.status);
  const Icon = meta.icon;
  const headline = headlineFor(entity);
  const batch = entity.attributes?.["Batch Number"] as string | undefined;
  const serial = entity.attributes?.["Serial Number"] as string | undefined;
  const jobId = entity.jobId ?? getEntityJobId(entity.attributes);
  const trackingHint = serial
    ? `Serial - ${serial}`
    : batch
      ? `Batch - ${batch}`
      : (entity.sourceDocument ?? entity.id.slice(0, 12));
  const jobHint = entity.jobReadableId ?? jobId ?? "No job";
  const trackingIdHint = entity.readableId ?? entity.id;

  return (
    <CommandItem
      value={`${headline} ${entity.id} ${serial ?? ""} ${batch ?? ""} ${entity.sourceDocumentReadableId ?? ""} ${entity.readableId ?? ""} ${entity.jobReadableId ?? ""} ${jobId ?? ""}`}
      onSelect={onSelect}
      className="!py-2.5 !px-3 gap-3 cursor-pointer rounded-lg"
    >
      <span
        className="size-9 rounded-lg flex items-center justify-center shrink-0 ring-1 ring-foreground/10 shadow-sm"
        style={{ background: meta.color }}
      >
        <Icon className="size-4 text-white drop-shadow-sm" />
      </span>
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <TruncatedTooltipText
          className="block text-sm font-medium truncate leading-5"
          tooltip={headline}
        >
          {headline}
        </TruncatedTooltipText>
        <p className="text-[11px] text-muted-foreground truncate leading-4">
          {trackingHint}
        </p>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground leading-4 min-w-0">
          <TruncatedTooltipText
            className="block min-w-0 truncate"
            tooltip={`Job ${jobHint}`}
          >
            {`Job ${jobHint}`}
          </TruncatedTooltipText>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="shrink-0 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                aria-label="View full job and tracking details"
              >
                <LuInfo className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              <div className="text-xs leading-5">
                <div>{`Job: ${jobHint}`}</div>
                <div>{`Tracking: ${trackingIdHint}`}</div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <HStack spacing={2} className="items-center shrink-0">
        {entity.status && (
          <Badge
            variant="secondary"
            className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5"
          >
            {entity.status}
          </Badge>
        )}
        <span className="text-xs tabular-nums font-medium text-foreground w-10 text-right">
          {entity.quantity}
        </span>
      </HStack>
    </CommandItem>
  );
}

function headlineFor(entity: EntityRow): string {
  return (
    (entity.attributes?.["Serial Number"] as string | undefined) ??
    (entity.attributes?.["Batch Number"] as string | undefined) ??
    entity.sourceDocumentReadableId ??
    entity.readableId ??
    entity.id.slice(0, 12)
  );
}

function getEntityJobId(attributes: EntityRow["attributes"]): string | null {
  const job = attributes?.Job;
  return typeof job === "string" && job.length > 0 ? job : null;
}

function SearchSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="py-2">
      <span className="sr-only">Searching</span>
      <div className="px-3 pt-1 pb-1.5">
        <div className="h-2.5 w-16 rounded-full bg-foreground/10 animate-pulse" />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg [animation-delay:var(--d)]"
          style={{ ["--d" as any]: `${i * 90}ms` }}
        >
          <div className="size-9 rounded-lg shrink-0 bg-foreground/10 animate-pulse" />
          <div className="flex flex-col flex-1 min-w-0 gap-1.5">
            <div
              className="h-3 rounded-full bg-foreground/10 animate-pulse"
              style={{ width: `${60 + ((i * 13) % 30)}%` }}
            />
            <div
              className="h-2.5 rounded-full bg-foreground/[0.07] animate-pulse"
              style={{ width: `${30 + ((i * 17) % 25)}%` }}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-4 w-14 rounded-md bg-foreground/10 animate-pulse" />
            <div className="h-3 w-6 rounded-full bg-foreground/10 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
