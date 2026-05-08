import { getCarbon, getUser } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { requireAuthSession } from "@carbon/auth/session.server";
import {
  Avatar,
  Badge,
  Button,
  cn,
  Heading,
  Input,
  SidebarTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuClipboardList,
  LuMapPin,
  LuPackage,
  LuRefreshCw,
  LuSearch,
  LuTriangleAlert,
  LuWrench
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { useDateFormatter } from "~/hooks/useDateFormatter";
import { getPickingListsForOperator } from "~/services/inventory.service";
import { getLocation } from "~/services/location.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const { accessToken } = await requireAuthSession(request);
  const authClient = getCarbon(accessToken);
  const { location } = await getLocation(request, client, {
    userId,
    companyId
  });

  const [pickingListsRes, userRes] = await Promise.all([
    getPickingListsForOperator(client, companyId, {
      userId,
      locationId: location ?? undefined
    }),
    getUser(authClient, userId)
  ]);

  let locationName: string | null = null;
  if (location) {
    const loc = await client
      .from("location")
      .select("name")
      .eq("id", location)
      .single();
    locationName = loc.data?.name ?? null;
  }

  return {
    pickingLists: pickingListsRes.data ?? [],
    user: userRes.data
      ? {
          fullName: userRes.data.fullName ?? null,
          avatarUrl: userRes.data.avatarUrl ?? null
        }
      : null,
    locationName
  };
}

type Filter = "overdue" | "inProgress" | "released" | "confirmed" | null;

export default function PickingListsRoute() {
  const { t } = useLingui();
  const { pickingLists, user, locationName } = useLoaderData<typeof loader>();
  const { formatDate, formatRelativeTime } = useDateFormatter();
  const revalidator = useRevalidator();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<Filter>(null);

  const now = useMemo(() => Date.now(), []);

  const enriched = useMemo(() => {
    return pickingLists.map((pl: any) => {
      const lines = (pl.pickingListLine ?? []) as Array<{
        estimatedQuantity: number | null;
        adjustedQuantity: number | null;
        pickedQuantity: number | null;
      }>;
      let unitsRequired = 0;
      let unitsPicked = 0;
      let linesPicked = 0;
      for (const l of lines) {
        const required = Number(l.adjustedQuantity ?? l.estimatedQuantity ?? 0);
        const picked = Number(l.pickedQuantity ?? 0);
        unitsRequired += required;
        unitsPicked += Math.min(picked, required || picked);
        if (picked > 0) linesPicked += 1;
      }
      const dueMs = pl.dueDate ? new Date(pl.dueDate).getTime() : null;
      const isOverdue =
        dueMs != null &&
        dueMs < now &&
        !["Confirmed", "Cancelled"].includes(pl.status);

      return {
        ...pl,
        _lineCount: lines.length,
        _linesPicked: linesPicked,
        _unitsRequired: unitsRequired,
        _unitsPicked: unitsPicked,
        _isOverdue: isOverdue
      };
    });
  }, [pickingLists, now]);

  const counts = useMemo(() => {
    let overdue = 0;
    let inProgress = 0;
    let released = 0;
    let confirmed = 0;
    for (const pl of enriched) {
      if (pl._isOverdue) overdue += 1;
      if (pl.status === "In Progress") inProgress += 1;
      else if (pl.status === "Released") released += 1;
      else if (pl.status === "Confirmed") confirmed += 1;
    }
    return { overdue, inProgress, released, confirmed };
  }, [enriched]);

  const filtered = useMemo(() => {
    const matchesSearch = (pl: any) => {
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      const job = pl.job as any;
      return (
        pl.pickingListId?.toLowerCase().includes(q) ||
        job?.jobId?.toLowerCase().includes(q) ||
        job?.item?.readableId?.toLowerCase().includes(q) ||
        job?.item?.name?.toLowerCase().includes(q)
      );
    };
    const matchesFilter = (pl: any) => {
      if (!activeFilter) return true;
      if (activeFilter === "overdue") return pl._isOverdue;
      if (activeFilter === "inProgress") return pl.status === "In Progress";
      if (activeFilter === "released") return pl.status === "Released";
      if (activeFilter === "confirmed") return pl.status === "Confirmed";
      return true;
    };
    return enriched
      .filter((pl) => matchesSearch(pl) && matchesFilter(pl))
      .slice()
      .sort((a, b) => {
        const aRank = a._isOverdue ? 0 : statusRank(a.status);
        const bRank = b._isOverdue ? 0 : statusRank(b.status);
        if (aRank !== bRank) return aRank - bRank;
        const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aDue - bDue;
      });
  }, [enriched, searchTerm, activeFilter]);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <header className="sticky top-0 z-10 flex flex-col gap-2 border-b bg-background px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <div className="flex flex-col">
              <Heading size="h4">
                <Trans>My Picks</Trans>
              </Heading>
              <span className="text-xs text-muted-foreground">
                {[user?.fullName, locationName].filter(Boolean).join(" · ") ||
                  t`Operator`}
              </span>
            </div>
          </div>
          {user && (
            <Avatar
              size="md"
              name={user.fullName ?? undefined}
              src={user.avatarUrl ?? undefined}
            />
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <FilterPill
            label={t`Overdue`}
            count={counts.overdue}
            active={activeFilter === "overdue"}
            tone="danger"
            onClick={() =>
              setActiveFilter(activeFilter === "overdue" ? null : "overdue")
            }
          />
          <FilterPill
            label={t`In Progress`}
            count={counts.inProgress}
            active={activeFilter === "inProgress"}
            tone="info"
            onClick={() =>
              setActiveFilter(
                activeFilter === "inProgress" ? null : "inProgress"
              )
            }
          />
          <FilterPill
            label={t`Released`}
            count={counts.released}
            active={activeFilter === "released"}
            tone="warning"
            onClick={() =>
              setActiveFilter(activeFilter === "released" ? null : "released")
            }
          />
          <FilterPill
            label={t`Confirmed`}
            count={counts.confirmed}
            active={activeFilter === "confirmed"}
            tone="success"
            onClick={() =>
              setActiveFilter(activeFilter === "confirmed" ? null : "confirmed")
            }
          />
          <button
            type="button"
            aria-label={t`Refresh`}
            onClick={() => revalidator.revalidate()}
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LuRefreshCw
              className={cn(
                "h-4 w-4",
                revalidator.state === "loading" && "animate-spin"
              )}
            />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full overflow-y-auto px-4 py-4">
        <div className="relative mb-4">
          <LuSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t`Search by PL, job, or item`}
            className="pl-8"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col flex-1 w-full items-center justify-center gap-4 py-16">
            <div className="flex justify-center items-center h-12 w-12 rounded-full bg-muted text-muted-foreground">
              <LuClipboardList className="h-6 w-6" />
            </div>
            <span className="text-xs uppercase font-mono text-muted-foreground">
              {searchTerm || activeFilter ? (
                <Trans>No results</Trans>
              ) : (
                <Trans>No picking lists assigned</Trans>
              )}
            </span>
            {(searchTerm || activeFilter) && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchTerm("");
                  setActiveFilter(null);
                }}
              >
                <Trans>Clear filters</Trans>
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {filtered.map((pl: any, index: number) => (
                <PickingListCard
                  key={pl.id}
                  pl={pl}
                  index={index + 1}
                  formatDate={formatDate}
                  formatRelativeTime={formatRelativeTime}
                />
              ))}
            </div>
            <div className="mt-6 text-center text-xs text-muted-foreground">
              {filtered.length}{" "}
              {filtered.length === 1 ? (
                <Trans>picking list assigned</Trans>
              ) : (
                <Trans>picking lists assigned</Trans>
              )}{" "}
              ·{" "}
              <button
                type="button"
                onClick={() => revalidator.revalidate()}
                className="hover:text-foreground"
              >
                <Trans>pull to refresh</Trans>
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function statusRank(status: string): number {
  if (status === "In Progress") return 1;
  if (status === "Released") return 2;
  if (status === "Confirmed") return 3;
  return 4;
}

function FilterPill({
  label,
  count,
  active,
  tone,
  onClick
}: {
  label: string;
  count: number;
  active: boolean;
  tone: "danger" | "info" | "warning" | "success";
  onClick: () => void;
}) {
  const toneClasses: Record<typeof tone, string> = {
    danger: active
      ? "border-red-500/60 bg-red-500/10 text-red-500"
      : "border-red-500/30 text-red-500/80 hover:bg-red-500/5",
    info: active
      ? "border-blue-500/60 bg-blue-500/10 text-blue-400"
      : "border-blue-500/30 text-blue-400/80 hover:bg-blue-500/5",
    warning: active
      ? "border-amber-500/60 bg-amber-500/10 text-amber-400"
      : "border-amber-500/30 text-amber-400/80 hover:bg-amber-500/5",
    success: active
      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
      : "border-emerald-500/30 text-emerald-400/80 hover:bg-emerald-500/5"
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        toneClasses[tone]
      )}
    >
      {tone === "danger" && (
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      )}
      <span>{label}</span>
      <span className="opacity-70">·</span>
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

function PickingListCard({
  pl,
  index,
  formatDate,
  formatRelativeTime
}: {
  pl: any;
  index: number;
  formatDate: (d?: string | null) => string;
  formatRelativeTime: (d: string) => string;
}) {
  const isOverdue = pl._isOverdue;
  const isReadOnly = ["Confirmed", "Cancelled"].includes(pl.status);
  const linesPct =
    pl._lineCount > 0 ? Math.min(pl._linesPicked / pl._lineCount, 1) : 0;
  const unitsPct =
    pl._unitsRequired > 0
      ? Math.min(pl._unitsPicked / pl._unitsRequired, 1)
      : 0;

  return (
    <Link
      to={path.to.pickingList(pl.id)}
      className={cn(
        "group block rounded-lg border bg-card transition-colors",
        isOverdue
          ? "border-red-500/40 hover:border-red-500/70"
          : isReadOnly
            ? "border-border/60 opacity-75 hover:opacity-100"
            : "hover:border-primary"
      )}
    >
      <div className="flex">
        {/* Index column */}
        <div className="flex flex-col items-center justify-start gap-0.5 px-3 py-3 border-r border-border/50 min-w-[44px]">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            #
          </span>
          <span className="text-base font-semibold tabular-nums">{index}</span>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col gap-2 px-4 py-3 min-w-0">
          {/* Top row: PL ID · Job · status · overdue · due (right) */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <span className="font-semibold tabular-nums">
                {pl.pickingListId}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {pl.job?.jobId ?? "—"}
              </span>
              <StatusBadge status={pl.status} />
              {isOverdue && (
                <span className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-red-500">
                  <LuTriangleAlert className="h-3 w-3" />
                  <Trans>Overdue</Trans>
                </span>
              )}
            </div>
            <DueLabel
              dueDate={pl.dueDate}
              isOverdue={isOverdue}
              formatDate={formatDate}
              formatRelativeTime={formatRelativeTime}
            />
          </div>

          {/* Item */}
          {pl.job?.item && (
            <div className="flex items-center gap-2 text-sm">
              <LuPackage className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">
                {pl.job.item.name ?? pl.job.item.readableId}
              </span>
              {pl.job.item.readableId && pl.job.item.name && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {pl.job.item.readableId}
                </span>
              )}
            </div>
          )}

          {/* Location */}
          {pl.location?.name && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <LuWrench className="h-3 w-3" />
                {pl.location.name}
              </span>
              <span className="flex items-center gap-1">
                <LuMapPin className="h-3 w-3" />
                <Trans>stage at</Trans>
              </span>
              <Badge variant="outline" className="tabular-nums">
                {pl.location.name}
              </Badge>
            </div>
          )}

          {/* Progress */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-1">
            <ProgressRow
              label={<Trans>Lines</Trans>}
              current={pl._linesPicked}
              total={pl._lineCount}
              pct={linesPct}
            />
            <ProgressRow
              label={<Trans>Units</Trans>}
              current={pl._unitsPicked}
              total={pl._unitsRequired}
              pct={unitsPct}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "In Progress"
      ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
      : status === "Released"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
        : status === "Confirmed"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : status === "Cancelled"
            ? "border-muted-foreground/40 bg-muted/40 text-muted-foreground"
            : "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        classes
      )}
    >
      {status}
    </span>
  );
}

function DueLabel({
  dueDate,
  isOverdue,
  formatDate,
  formatRelativeTime
}: {
  dueDate: string | null;
  isOverdue: boolean;
  formatDate: (d?: string | null) => string;
  formatRelativeTime: (d: string) => string;
}) {
  if (!dueDate) return null;
  return (
    <div
      className={cn(
        "flex flex-col items-end shrink-0 text-right",
        isOverdue ? "text-red-500" : "text-muted-foreground"
      )}
    >
      <span className="text-xs font-medium">{formatDate(dueDate)}</span>
      <span className="text-[10px]">{formatRelativeTime(dueDate)}</span>
    </div>
  );
}

function ProgressRow({
  label,
  current,
  total,
  pct
}: {
  label: React.ReactNode;
  current: number;
  total: number;
  pct: number;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {current}/{total || 0}
        </span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full transition-all",
            pct >= 1 ? "bg-emerald-500" : "bg-blue-500"
          )}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
