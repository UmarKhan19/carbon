import {
  Button,
  cn,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import {
  LuCalendar,
  LuEllipsis,
  LuLink,
  LuMapPin,
  LuPercent,
  LuShoppingCart,
  LuUser,
  LuUsers,
  LuWarehouse
} from "react-icons/lu";
import { useParams } from "react-router";
import {
  Assignee,
  EmployeeAvatar,
  Hyperlink,
  useOptimisticAssignment
} from "~/components";
import { useDateFormatter, usePermissions, useRouteData } from "~/hooks";
import type { PickingListDetail, PickingListLine } from "~/modules/inventory";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import PickingListStatus from "./PickingListStatus";

// ─── Donut chart ──────────────────────────────────────────────

function DonutChart({ pct }: { pct: number }) {
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * Math.min(pct / 100, 1);
  const gap = circumference - dash;

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg
        width="144"
        height="144"
        viewBox="0 0 144 144"
        className="-rotate-90"
      >
        {/* Track */}
        <circle
          cx="72"
          cy="72"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          className="text-muted-foreground/15"
        />
        {/* Fill */}
        <circle
          cx="72"
          cy="72"
          r={radius}
          fill="none"
          stroke="url(#donut-gradient)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          style={{ transition: "stroke-dasharray 0.7s ease-out" }}
        />
        <defs>
          <linearGradient id="donut-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold tabular-nums leading-none">
          {pct}%
        </span>
        {pct > 0 && (
          <span className="text-[10px] text-muted-foreground mt-0.5">
            complete
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Property row ─────────────────────────────────────────────

function PropertyRow({
  label,
  icon,
  children
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
        {icon}
        {label}
      </span>
      <span className="flex items-center text-right">{children}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────

export default function PickingListProperties() {
  const { id } = useParams();
  if (!id) throw new Error("id required");

  const { formatDate, formatRelativeTime } = useDateFormatter();
  const permissions = usePermissions();

  const routeData = useRouteData<{
    pickingList: PickingListDetail & {
      job?: {
        id?: string;
        jobId?: string;
        salesOrderId?: string | null;
        salesOrder?: { id?: string; salesOrderId?: string | null } | null;
        customer?: { id?: string; name?: string | null } | null;
        item?: { name?: string | null; readableId?: string | null } | null;
      } | null;
      location?: { name?: string | null } | null;
      destinationStorageUnit?: { id?: string; name?: string | null } | null;
      assigneeUser?: {
        id?: string;
        fullName?: string | null;
        avatarUrl?: string | null;
      } | null;
    };
    pickingListLines: PickingListLine[];
  }>(path.to.pickingList(id));

  const pl = routeData?.pickingList;
  const lines = routeData?.pickingListLines ?? [];

  const totals = lines.reduce(
    (acc, l) => {
      const required = Number(l.adjustedQuantity ?? l.estimatedQuantity ?? 0);
      const picked = Number(l.pickedQuantity ?? 0);
      acc.required += required;
      acc.picked += Math.min(picked, required || picked);
      return acc;
    },
    { required: 0, picked: 0 }
  );
  const pct =
    totals.required > 0
      ? Math.round((totals.picked / totals.required) * 100)
      : 0;

  const optimisticAssignment = useOptimisticAssignment({
    id,
    table: "pickingList"
  });
  const assignee =
    optimisticAssignment !== undefined ? optimisticAssignment : pl?.assignee;
  const canUpdate = permissions.can("update", "inventory");

  if (!pl) return null;

  const itemName = pl.job?.item?.name;
  const itemReadableId = pl.job?.item?.readableId;
  const stageName = (pl as any).destinationStorageUnit?.name;
  const tolerance = (lines[0] as any)?.overpickTolerancePercent;

  return (
    <VStack
      spacing={0}
      className="w-full bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border text-sm flex-col"
    >
      {/* Header */}
      <div className="w-full flex items-center justify-between px-4 py-3 border-b border-border/60">
        <h3 className="text-[10px] text-foreground/60 uppercase font-semibold tracking-widest">
          <Trans>Properties</Trans>
        </h3>
        <HStack spacing={1}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() =>
                  copyToClipboard(
                    window.location.origin + path.to.pickingList(id)
                  )
                }
              >
                <LuLink className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <Trans>Copy link</Trans>
            </TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <LuEllipsis className="size-3.5" />
          </Button>
        </HStack>
      </div>

      <div className="w-full px-4 py-4 space-y-5 flex-1">
        {/* PL identity */}
        <div>
          <p className="text-sm font-semibold">{pl.pickingListId}</p>
          {(itemReadableId || itemName) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {itemReadableId ? `Pick for ${itemReadableId}` : itemName}
            </p>
          )}
        </div>

        {/* Donut chart */}
        <div className="flex justify-center py-2">
          <DonutChart pct={pct} />
        </div>

        {/* Properties */}
        <div className="space-y-2.5">
          <PropertyRow label={<Trans>Status</Trans>}>
            <PickingListStatus status={pl.status as any} />
          </PropertyRow>

          {pl.job?.jobId && (
            <PropertyRow
              label={<Trans>Job</Trans>}
              icon={<LuWarehouse className="size-3" />}
            >
              <Hyperlink to={path.to.job(pl.jobId!)}>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-blue-500/30 text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/15 transition-colors">
                  JOB · {pl.job.jobId}
                </span>
              </Hyperlink>
            </PropertyRow>
          )}

          {(pl.job?.salesOrder?.salesOrderId ?? pl.job?.salesOrderId) && (
            <PropertyRow
              label={<Trans>Sales Order</Trans>}
              icon={<LuShoppingCart className="size-3" />}
            >
              {pl.job?.salesOrderId ? (
                <Hyperlink to={path.to.salesOrder(pl.job.salesOrderId)}>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-amber-500/30 text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/15 transition-colors">
                    {pl.job?.salesOrder?.salesOrderId ?? pl.job.salesOrderId}
                  </span>
                </Hyperlink>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-amber-500/30 text-xs font-medium bg-amber-500/10 text-amber-400">
                  {pl.job?.salesOrder?.salesOrderId ?? ""}
                </span>
              )}
            </PropertyRow>
          )}

          {pl.job?.customer?.name && (
            <PropertyRow
              label={<Trans>Customer</Trans>}
              icon={<LuUsers className="size-3" />}
            >
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span className="inline-flex items-center justify-center size-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold shrink-0">
                  {pl.job.customer.name[0].toUpperCase()}
                </span>
                {pl.job.customer.name}
              </span>
            </PropertyRow>
          )}

          {pl.location?.name && (
            <PropertyRow
              label={<Trans>Warehouse</Trans>}
              icon={<LuMapPin className="size-3" />}
            >
              <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-violet-500/30 text-xs font-medium bg-violet-500/10 text-violet-400">
                {pl.location.name}
              </span>
            </PropertyRow>
          )}

          {stageName && (
            <PropertyRow label={<Trans>Stage at</Trans>}>
              <span className="text-xs">{stageName}</span>
            </PropertyRow>
          )}

          {tolerance != null && (
            <PropertyRow
              label={<Trans>Tolerance</Trans>}
              icon={<LuPercent className="size-3" />}
            >
              <span className="text-xs tabular-nums">{tolerance}%</span>
            </PropertyRow>
          )}

          <PropertyRow
            label={<Trans>Assignee</Trans>}
            icon={<LuUser className="size-3" />}
          >
            {pl.assignee ? (
              <EmployeeAvatar employeeId={pl.assignee} size="sm" />
            ) : (
              <span className="text-xs text-muted-foreground">
                <Trans>Unassigned</Trans>
              </span>
            )}
          </PropertyRow>

          <PropertyRow
            label={<Trans>Due</Trans>}
            icon={<LuCalendar className="size-3" />}
          >
            {pl.dueDate ? (
              <span
                className={cn(
                  "text-xs",
                  new Date(pl.dueDate) < new Date() &&
                    !["Confirmed", "Cancelled"].includes(pl.status ?? "")
                    ? "text-red-400"
                    : ""
                )}
              >
                {formatDate(pl.dueDate)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </PropertyRow>

          <PropertyRow
            label={<Trans>Created</Trans>}
            icon={<LuCalendar className="size-3" />}
          >
            {pl.createdAt ? (
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(pl.createdAt)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </PropertyRow>
        </div>
      </div>

      {/* Assignee control */}
      <div className="w-full border-t border-border/60 px-4 py-3">
        <Assignee
          id={id}
          table="pickingList"
          value={assignee ?? ""}
          variant="inline"
          isReadOnly={!canUpdate}
        />
      </div>

      {/* Actions */}
      <div className="w-full border-t border-border/60 px-4 py-3">
        <p className="text-[10px] text-foreground/60 uppercase font-semibold tracking-widest mb-2">
          <Trans>Actions</Trans>
        </p>
        <div className="text-xs text-muted-foreground">
          <Trans>
            Use the header menu to release, confirm, or reverse this picking
            list.
          </Trans>
        </div>
      </div>
    </VStack>
  );
}
