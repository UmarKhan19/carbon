import {
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuBolt,
  LuCalendar,
  LuChevronDown,
  LuChevronUp,
  LuCirclePlus,
  LuClock,
  LuEllipsisVertical,
  LuHash,
  LuMapPin,
  LuPencilLine,
  LuQrCode,
  LuTrash,
  LuUndo2
} from "react-icons/lu";
import {
  Link,
  useFetcher,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router";
import { Empty, ItemThumbnail, TrackingTypeIcon } from "~/components";
import { useDateFormatter, usePermissions, useRouteData } from "~/hooks";
import type { PickingListDetail, PickingListLine } from "~/modules/inventory";
import { path } from "~/utils/path";
import PickingListStatus from "./PickingListStatus";

type IncidentTooltipRow = {
  id: string;
  incidentId: string | null;
  itemId: string | null;
  trackedEntityId: string | null;
  quantityLost: number;
  incidentDate: string;
  incidentType: { name: string } | null;
};

// ─── Helpers ─────────────────────────────────────────────────

function lineStatus(line: PickingListLine) {
  const picked = Number(line.pickedQuantity ?? 0);
  if (Number(line.overPickQuantity ?? 0) > 0) return "overpicked";
  if (picked <= 0) return "pending";
  if (Number(line.outstandingQuantity ?? 0) <= 0) return "completed";
  return "in_progress";
}

function LineStatusBadge({ line }: { line: PickingListLine }) {
  const s = lineStatus(line);
  if (s === "completed")
    return (
      <Badge variant="green">
        <Trans>Completed</Trans>
      </Badge>
    );
  if (s === "overpicked")
    return (
      <Badge variant="orange">
        <Trans>Overpicked</Trans>
      </Badge>
    );
  if (s === "in_progress")
    return (
      <Badge variant="blue">
        <Trans>In Progress</Trans>
      </Badge>
    );
  return (
    <Badge variant="gray">
      <Trans>Not Started</Trans>
    </Badge>
  );
}

// ─── Active Line Detail Card ──────────────────────────────────

interface ActiveLineCardProps {
  line: PickingListLine;
  lineNumber: number;
  isEditable: boolean;
  canApprove: boolean;
  canManage: boolean;
  matchingIncidents: IncidentTooltipRow[];
  onPick: (
    line: PickingListLine,
    qty: number,
    acknowledgeOverpick?: boolean
  ) => void;
  onUnpick: (line: PickingListLine) => void;
  onScan: (line: PickingListLine) => void;
  onEdit: (line: PickingListLine) => void;
  onDelete: (line: PickingListLine) => void;
}

function ActiveLineCard({
  line,
  lineNumber,
  isEditable,
  canApprove,
  canManage,
  matchingIncidents,
  onPick,
  onUnpick,
  onScan,
  onEdit,
  onDelete
}: ActiveLineCardProps) {
  const { t } = useLingui();
  const item = (line as any).item;
  const storageUnit = (line as any).storageUnit;
  const destinationStorageUnit = (line as any).destinationStorageUnit;
  const isTracked = line.requiresBatchTracking || line.requiresSerialTracking;
  const isPicked = (line.pickedQuantity ?? 0) > 0;
  const required = Number(line.adjustedQuantity ?? line.estimatedQuantity ?? 0);
  const picked = Number(line.pickedQuantity ?? 0);
  const remaining = Number(line.outstandingQuantity ?? 0);
  const [qty, setQty] = useState<number>(picked);

  useEffect(() => {
    setQty(picked);
  }, [picked]);

  const handlePickQuantityBlur = () => {
    if (!Number.isFinite(qty) || qty === picked) return;
    const tolerance = (line as any).overpickTolerancePercent ?? 2;
    const warnAt = required * (1 + tolerance / 100);
    const hardBlockAt = required * 2;
    const uom = line.unitOfMeasureCode ?? "";

    if (required > 0 && qty > hardBlockAt) {
      if (!canApprove) {
        window.alert(
          t`Cannot pick ${qty} ${uom}: exceeds 2x the required quantity (${hardBlockAt}). Approver override required.`
        );
        setQty(picked);
        return;
      }
      const ok = window.confirm(
        t`Approver override: pick ${qty} ${uom}? This is more than 2x the required ${required} ${uom}.`
      );
      if (!ok) {
        setQty(picked);
        return;
      }
      onPick(line, qty, true);
      return;
    }
    if (required > 0 && qty > warnAt) {
      const ok = window.confirm(
        t`Picking ${qty} ${uom} exceeds the required ${required} by more than ${tolerance}%. Continue?`
      );
      if (!ok) {
        setQty(picked);
        return;
      }
    }
    onPick(line, qty);
  };

  return (
    <Card className="w-full overflow-hidden">
      {/* Line header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
        <HStack spacing={2}>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Line {lineNumber}
          </span>
          <span className="text-sm font-semibold">{item?.name}</span>
          {item?.readableId && (
            <span className="text-xs text-muted-foreground">
              {item.readableId}
            </span>
          )}
        </HStack>
        <LineStatusBadge line={line} />
      </div>

      <CardContent className="px-5 py-4 space-y-4">
        {/* Source → Destination */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">
              <Trans>Source</Trans>
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {storageUnit?.name ? (
                <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-muted/60 text-sm font-medium border border-border/60">
                  {storageUnit.name}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  <Trans>Unassigned</Trans>
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">
              <Trans>Destination</Trans>
            </p>
            {destinationStorageUnit?.name ? (
              <span className="inline-flex items-center px-3 py-1 rounded-md bg-emerald-500/10 text-emerald-400 text-sm font-medium border border-emerald-500/20">
                {destinationStorageUnit.name}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </div>
        </div>

        {/* Tracked entity */}
        {line.pickedTrackedEntityId && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border/60">
            <LuQrCode className="size-3 text-muted-foreground shrink-0" />
            <span className="text-xs font-mono text-muted-foreground">
              {line.pickedTrackedEntityId}
            </span>
          </div>
        )}

        {/* Required / Picked / Remaining */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">
              <Trans>Required</Trans>
            </p>
            {line.adjustedQuantity != null && matchingIncidents.length > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    <div className="text-sm line-through text-muted-foreground tabular-nums">
                      {line.estimatedQuantity}
                    </div>
                    <div className="text-2xl font-bold text-orange-400 tabular-nums leading-none">
                      {line.adjustedQuantity}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <div className="text-xs space-y-1">
                    <div className="font-medium">
                      <Trans>Reduced by incident:</Trans>
                    </div>
                    {matchingIncidents.map((inc) => (
                      <div key={inc.id} className="flex flex-col">
                        <span>
                          {inc.incidentId ?? inc.id.slice(0, 8)}
                          {inc.incidentType?.name
                            ? ` — ${inc.incidentType.name}`
                            : ""}
                        </span>
                        <span className="text-muted-foreground">
                          {inc.quantityLost} {line.unitOfMeasureCode} lost on{" "}
                          {new Date(inc.incidentDate).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : (
              <span className="text-2xl font-bold tabular-nums leading-none">
                {required}
              </span>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">
              <Trans>Picked</Trans>
            </p>
            <span
              className={cn(
                "text-2xl font-bold tabular-nums leading-none",
                picked > 0 ? "text-blue-400" : "text-muted-foreground"
              )}
            >
              {picked}
            </span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">
              <Trans>Remaining</Trans>
            </p>
            <span
              className={cn(
                "text-2xl font-bold tabular-nums leading-none",
                remaining > 0 ? "text-orange-400" : "text-emerald-400"
              )}
            >
              {remaining}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <HStack spacing={2}>
            {isEditable && isTracked && (
              <Button
                variant={line.pickedTrackedEntityId ? "secondary" : "primary"}
                leftIcon={<LuQrCode />}
                onClick={() => onScan(line)}
                className="active:scale-[0.96] transition-transform"
              >
                {line.pickedTrackedEntityId ? (
                  <Trans>Re-scan entity</Trans>
                ) : (
                  <Trans>Scan entity</Trans>
                )}
              </Button>
            )}
            {isEditable && !isTracked && (
              <NumberField
                value={qty}
                onChange={(value) => setQty(Number.isFinite(value) ? value : 0)}
                minValue={0}
              >
                <NumberInputGroup className="relative">
                  <NumberInput
                    className="w-[110px] [&_input]:text-center"
                    size="sm"
                    step={0.01}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    onBlur={handlePickQuantityBlur}
                  />
                  <NumberInputStepper>
                    <NumberIncrementStepper>
                      <LuChevronUp size="1em" strokeWidth="3" />
                    </NumberIncrementStepper>
                    <NumberDecrementStepper>
                      <LuChevronDown size="1em" strokeWidth="3" />
                    </NumberDecrementStepper>
                  </NumberInputStepper>
                </NumberInputGroup>
              </NumberField>
            )}
            {isEditable && isPicked && (
              <Button
                variant="secondary"
                leftIcon={<LuUndo2 />}
                onClick={() => onUnpick(line)}
                className="active:scale-[0.96] transition-transform"
              >
                <Trans>Unpick</Trans>
              </Button>
            )}
            {canManage && (
              <Button
                variant="secondary"
                leftIcon={<LuPencilLine />}
                onClick={() => onEdit(line)}
                className="active:scale-[0.96] transition-transform"
              >
                <Trans>Edit line</Trans>
              </Button>
            )}
          </HStack>
          {canManage && (
            <Button
              variant="ghost"
              leftIcon={<LuTrash />}
              className="text-muted-foreground hover:text-destructive active:scale-[0.96] transition-transform"
              isDisabled={isPicked}
              onClick={() => onDelete(line)}
            >
              <Trans>Remove</Trans>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Compact table row ────────────────────────────────────────

interface LineTableRowProps {
  line: PickingListLine;
  index: number;
  isEditable: boolean;
  canManage: boolean;
  canApprove: boolean;
  matchingIncidents: IncidentTooltipRow[];
  isActive: boolean;
  onPick: (
    line: PickingListLine,
    qty: number,
    acknowledgeOverpick?: boolean
  ) => void;
  onUnpick: (line: PickingListLine) => void;
  onScan: (line: PickingListLine) => void;
  onEdit: (line: PickingListLine) => void;
  onDelete: (line: PickingListLine) => void;
  onSelect: (line: PickingListLine) => void;
}

function LineTableRow({
  line,
  index,
  isEditable,
  canManage,
  canApprove,
  matchingIncidents,
  isActive,
  onPick,
  onUnpick,
  onScan,
  onEdit,
  onDelete,
  onSelect
}: LineTableRowProps) {
  const { t } = useLingui();
  const item = (line as any).item;
  const storageUnit = (line as any).storageUnit;
  const isTracked = line.requiresBatchTracking || line.requiresSerialTracking;
  const required = Number(line.adjustedQuantity ?? line.estimatedQuantity ?? 0);
  const picked = Number(line.pickedQuantity ?? 0);
  const [qty, setQty] = useState<number>(picked);

  useEffect(() => {
    setQty(picked);
  }, [picked]);

  const handlePickQuantityBlur = () => {
    if (!Number.isFinite(qty) || qty === picked) return;
    const tolerance = (line as any).overpickTolerancePercent ?? 2;
    const warnAt = required * (1 + tolerance / 100);
    const hardBlockAt = required * 2;
    const uom = line.unitOfMeasureCode ?? "";

    if (required > 0 && qty > hardBlockAt) {
      if (!canApprove) {
        window.alert(
          t`Cannot pick ${qty} ${uom}: exceeds 2x the required quantity (${hardBlockAt}). Approver override required.`
        );
        setQty(picked);
        return;
      }
      const ok = window.confirm(
        t`Approver override: pick ${qty} ${uom}? This is more than 2x the required ${required} ${uom}.`
      );
      if (!ok) {
        setQty(picked);
        return;
      }
      onPick(line, qty, true);
      return;
    }
    if (required > 0 && qty > warnAt) {
      const ok = window.confirm(
        t`Picking ${qty} ${uom} exceeds the required ${required} by more than ${tolerance}%. Continue?`
      );
      if (!ok) {
        setQty(picked);
        return;
      }
    }
    onPick(line, qty);
  };

  return (
    <tr
      className={cn(
        "group border-b border-border/60 last:border-0 transition-colors",
        isActive ? "bg-muted/50" : "hover:bg-muted/30",
        "cursor-pointer"
      )}
      onClick={() => onSelect(line)}
    >
      <td className="py-3 pl-4 pr-2 w-8">
        <span className="text-xs text-muted-foreground tabular-nums w-5 text-right block">
          {String(index + 1).padStart(2, "0")}
        </span>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2.5">
          <ItemThumbnail
            size="sm"
            thumbnailPath={item?.thumbnailPath}
            type={(item?.type as "Part") ?? "Part"}
          />
          <div className="min-w-0">
            <div className="text-xs font-medium truncate max-w-[180px]">
              {item?.name}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {item?.readableId}
            </div>
          </div>
          {isTracked && (
            <div className="shrink-0">
              <TrackingTypeIcon
                type={line.requiresBatchTracking ? "Batch" : "Serial"}
                className="size-3 text-muted-foreground"
              />
            </div>
          )}
        </div>
      </td>
      <td className="py-3 pr-4">
        <span className="text-xs text-muted-foreground">
          {storageUnit?.name ?? "—"}
        </span>
      </td>
      <td className="py-3 pr-4 tabular-nums text-right">
        <span className="text-xs">{required}</span>
      </td>
      <td
        className="py-3 pr-4 tabular-nums text-right"
        onClick={(e) => e.stopPropagation()}
      >
        {isEditable && !isTracked ? (
          <NumberField
            value={qty}
            onChange={(value) => setQty(Number.isFinite(value) ? value : 0)}
            minValue={0}
          >
            <NumberInputGroup className="relative w-fit ml-auto">
              <NumberInput
                className="w-[80px] [&_input]:text-center [&_input]:text-xs"
                size="sm"
                step={0.01}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={handlePickQuantityBlur}
              />
              <NumberInputStepper>
                <NumberIncrementStepper>
                  <LuChevronUp size="1em" strokeWidth="3" />
                </NumberIncrementStepper>
                <NumberDecrementStepper>
                  <LuChevronDown size="1em" strokeWidth="3" />
                </NumberDecrementStepper>
              </NumberInputStepper>
            </NumberInputGroup>
          </NumberField>
        ) : isEditable && isTracked ? (
          <Button
            size="sm"
            variant={line.pickedTrackedEntityId ? "secondary" : "primary"}
            leftIcon={<LuQrCode />}
            onClick={(e) => {
              e.stopPropagation();
              onScan(line);
            }}
            className="active:scale-[0.96] transition-transform"
          >
            {line.pickedTrackedEntityId ? (
              <Trans>Re-scan</Trans>
            ) : (
              <Trans>Scan</Trans>
            )}
          </Button>
        ) : (
          <span
            className={cn(
              "text-xs tabular-nums font-medium",
              picked > 0 ? "text-emerald-400" : "text-muted-foreground"
            )}
          >
            {picked}
          </span>
        )}
      </td>
      <td className="py-3 pr-3">
        <LineStatusBadge line={line} />
      </td>
      <td className="py-3 pr-3" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              variant="ghost"
              icon={<LuEllipsisVertical />}
              aria-label={t`Line options`}
              size="sm"
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {isEditable && (line.pickedQuantity ?? 0) > 0 && (
              <DropdownMenuItem onClick={() => onUnpick(line)}>
                <DropdownMenuIcon icon={<LuUndo2 />} />
                <Trans>Unpick</Trans>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={!canManage}
              onClick={() => onEdit(line)}
            >
              <DropdownMenuIcon icon={<LuPencilLine />} />
              <Trans>Edit Line</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canManage || (line.pickedQuantity ?? 0) > 0}
              destructive
              onClick={() => onDelete(line)}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete Line</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

// ─── Stat card ────────────────────────────────────────────────

function StatCard({
  icon,
  iconColor,
  label,
  children,
  sub
}: {
  icon: React.ReactNode;
  iconColor?: string;
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card className="flex-1">
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <span className={cn("size-3.5 shrink-0", iconColor)}>{icon}</span>
          {label}
        </div>
        <div>{children}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────

const PickingListLines = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const [searchParams, setSearchParams] = useSearchParams();
  const activeLineId = searchParams.get("lineId");

  const routeData = useRouteData<{
    pickingList: PickingListDetail & {
      job?: {
        jobId?: string;
        item?: { name?: string | null; readableId?: string | null } | null;
        customer?: { id?: string; name?: string | null } | null;
        salesOrder?: { salesOrderId?: string | null } | null;
        salesOrderId?: string | null;
      } | null;
      location?: { name?: string | null } | null;
      destinationStorageUnit?: { name?: string | null } | null;
      createdByUser?: { fullName?: string | null } | null;
    };
    pickingListLines: PickingListLine[];
    incidents?: IncidentTooltipRow[];
  }>(path.to.pickingList(id));

  const pl = routeData?.pickingList;
  const lines = routeData?.pickingListLines ?? [];
  const incidents = routeData?.incidents ?? [];

  const { t } = useLingui();
  const { formatDate, formatRelativeTime } = useDateFormatter();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const pickFetcher = useFetcher();

  const allocationFetcher = useFetcher<{
    data: Array<{ itemId: string; allocatedQuantity: number }>;
  }>();
  const itemIds = lines.map((l) => l.itemId).filter(Boolean) as string[];

  useEffect(() => {
    if (itemIds.length > 0) {
      allocationFetcher.load(
        `/api/inventory/soft-allocations?itemIds=${itemIds.join(",")}&excludePickingListId=${id}`
      );
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: allocationFetcher.load changes every render; lines.length is the correct proxy for item list changes
  }, [id, lines.length]);

  const isEditable =
    pl != null &&
    ["Released", "In Progress"].includes(pl.status) &&
    permissions.can("update", "inventory");

  const canManageLines =
    pl != null &&
    !["Confirmed"].includes(pl.status) &&
    permissions.can("update", "inventory");

  const canApprove = permissions.can("approve", "inventory");

  const pickedCount = lines.filter((l) => (l.pickedQuantity ?? 0) > 0).length;
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

  const activeLine = activeLineId
    ? lines.find((l) => l.id === activeLineId)
    : null;
  const activeLineIndex = activeLine ? lines.indexOf(activeLine) : -1;

  const isOverdue =
    pl?.dueDate != null &&
    new Date(pl.dueDate) < new Date() &&
    !["Confirmed", "Cancelled"].includes(pl?.status ?? "");

  const onPick = (
    line: PickingListLine,
    qty: number,
    acknowledgeOverpick?: boolean
  ) => {
    pickFetcher.submit(
      {
        pickingListId: id,
        pickingListLineId: line.id!,
        pickedQuantity: qty,
        ...(acknowledgeOverpick ? { acknowledgeOverpick: "true" } : {})
      },
      { method: "post", action: path.to.pickingListLineQuantity(id) }
    );
  };

  const onUnpick = (line: PickingListLine) => {
    pickFetcher.submit(
      { pickingListId: id, pickingListLineId: line.id! },
      { method: "post", action: path.to.unpickPickingListLine(id, line.id!) }
    );
  };

  const onScan = (line: PickingListLine) =>
    navigate(path.to.pickingListScan(id, line.id!));
  const onEdit = (line: PickingListLine) =>
    navigate(path.to.pickingListLine(id, line.id!));

  const onDelete = (line: PickingListLine) => {
    if (!confirm(t`Delete this line?`)) return;
    pickFetcher.submit(
      {},
      { method: "post", action: path.to.pickingListLineDelete(id, line.id!) }
    );
  };

  const onSelectLine = (line: PickingListLine) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (next.get("lineId") === line.id) next.delete("lineId");
        else next.set("lineId", line.id!);
        return next;
      },
      { preventScrollReset: true }
    );
  };

  const onPickAllEligible = () => {
    const eligible = lines.filter(
      (l) =>
        !l.requiresBatchTracking &&
        !l.requiresSerialTracking &&
        Number(l.outstandingQuantity ?? 0) > 0
    );
    for (const line of eligible) {
      const required = Number(
        line.adjustedQuantity ?? line.estimatedQuantity ?? 0
      );
      pickFetcher.submit(
        {
          pickingListId: id,
          pickingListLineId: line.id!,
          pickedQuantity: required
        },
        { method: "post", action: path.to.pickingListLineQuantity(id) }
      );
    }
  };

  if (!pl) return null;

  const jobId = pl.job?.jobId;
  const itemName = pl.job?.item?.name;
  const itemReadableId = pl.job?.item?.readableId;
  const customerName = pl.job?.customer?.name;
  const salesOrderId = pl.job?.salesOrder?.salesOrderId ?? pl.job?.salesOrderId;
  const locationName = pl.location?.name;
  const stageName = pl.destinationStorageUnit?.name;
  const createdByName = (pl as any).createdByUser?.fullName;

  const pctComplete =
    totals.required > 0
      ? Math.round((totals.picked / totals.required) * 100)
      : 0;

  const hasEligibleLines = lines.some(
    (l) =>
      !l.requiresBatchTracking &&
      !l.requiresSerialTracking &&
      Number(l.outstandingQuantity ?? 0) > 0
  );

  return (
    <VStack spacing={4} className="w-full">
      {/* ── Hero section ─────────────────────────────────────── */}
      <Card className="w-full">
        <CardContent className="p-5 space-y-3">
          {/* Status row */}
          <div className="flex items-center justify-between">
            <HStack spacing={2}>
              <PickingListStatus status={pl.status as any} />
              {isOverdue && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-red-500/30 text-xs font-semibold bg-red-500/10 text-red-400 uppercase tracking-widest">
                  ⚠️ <Trans>Overdue</Trans>
                </span>
              )}
            </HStack>
            {createdByName && pl.createdAt && (
              <span className="text-xs text-muted-foreground">
                <Trans>Created by</Trans>{" "}
                <span className="text-foreground/80">{createdByName}</span>
                {" · "}
                {formatRelativeTime(pl.createdAt)}
              </span>
            )}
          </div>

          {/* Title */}
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-balance">
              {itemReadableId ? (
                <>Pick for {itemReadableId}</>
              ) : (
                pl.pickingListId
              )}
              {itemName && (
                <span className="ml-2.5 text-base font-normal text-muted-foreground">
                  {itemName}
                </span>
              )}
            </h2>
          </div>

          {/* Metadata row */}
          <HStack
            spacing={1}
            className="text-xs text-muted-foreground flex-wrap"
          >
            {jobId && (
              <Link
                to={path.to.job(pl.jobId!)}
                className="hover:text-foreground transition-colors font-medium"
              >
                {jobId}
              </Link>
            )}
            {salesOrderId && (
              <>
                <span className="text-border">·</span>
                <Link
                  to={path.to.salesOrder(pl.job?.salesOrderId ?? "")}
                  className="hover:text-foreground transition-colors font-medium"
                >
                  {salesOrderId}
                </Link>
              </>
            )}
            {customerName && (
              <>
                <span className="text-border">·</span>
                <span>{customerName}</span>
              </>
            )}
            {locationName && (
              <>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1">
                  <LuMapPin className="size-3" />
                  {locationName}
                </span>
              </>
            )}
          </HStack>
        </CardContent>
      </Card>

      {/* ── Stats row ──────────────────────────────────────────── */}
      <div className="w-full flex gap-3">
        <StatCard
          icon={<LuClock />}
          iconColor="text-emerald-500"
          label={t`Lines Picked`}
          sub={
            lines.length > 0 ? (
              <div className="mt-1.5 h-1 bg-muted/60 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.min((pickedCount / lines.length) * 100, 100)}%`
                  }}
                />
              </div>
            ) : undefined
          }
        >
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span
              className={cn(
                "text-3xl font-bold",
                pickedCount > 0 ? "text-emerald-400" : ""
              )}
            >
              {pickedCount}
            </span>
            <span className="text-base text-muted-foreground font-normal">
              of
            </span>
            <span className="text-3xl font-bold">{lines.length}</span>
          </div>
        </StatCard>

        <StatCard
          icon={<LuHash />}
          iconColor="text-blue-400"
          label={t`Units`}
          sub={`${pctComplete}% complete`}
        >
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span
              className={cn(
                "text-3xl font-bold",
                totals.picked > 0 ? "text-blue-400" : ""
              )}
            >
              {totals.picked}
            </span>
            <span className="text-base text-muted-foreground font-normal">
              of
            </span>
            <span className="text-3xl font-bold">{totals.required}</span>
          </div>
        </StatCard>

        <StatCard
          icon={<LuCalendar />}
          iconColor={isOverdue ? "text-red-400" : "text-orange-400"}
          label={t`Due`}
          sub={stageName ? `Stage at ${stageName}` : undefined}
        >
          {pl.dueDate ? (
            <span
              className={cn(
                "text-2xl font-bold tabular-nums",
                isOverdue ? "text-red-400" : ""
              )}
            >
              {formatDate(pl.dueDate)}
            </span>
          ) : (
            <span className="text-2xl font-bold text-muted-foreground">—</span>
          )}
        </StatCard>
      </div>

      {/* ── Active line detail ─────────────────────────────────── */}
      {activeLine && (
        <ActiveLineCard
          line={activeLine}
          lineNumber={activeLineIndex + 1}
          isEditable={isEditable}
          canApprove={canApprove}
          canManage={canManageLines}
          matchingIncidents={incidents.filter((inc) => {
            if (inc.itemId && inc.itemId !== activeLine.itemId) return false;
            if (
              inc.trackedEntityId &&
              inc.trackedEntityId !== activeLine.pickedTrackedEntityId
            )
              return false;
            return true;
          })}
          onPick={onPick}
          onUnpick={onUnpick}
          onScan={onScan}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}

      {/* ── Lines table ────────────────────────────────────────── */}
      <Card className="w-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <HStack spacing={2}>
            <span className="text-sm font-semibold">
              <Trans>Picking Lines</Trans>
            </span>
            <span className="inline-flex items-center justify-center size-5 rounded-full bg-muted text-[11px] font-medium tabular-nums">
              {lines.length}
            </span>
          </HStack>
          <HStack spacing={2}>
            {isEditable && hasEligibleLines && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LuBolt />}
                onClick={onPickAllEligible}
                className="active:scale-[0.96] transition-transform"
              >
                <Trans>Pick all eligible</Trans>
              </Button>
            )}
            {canManageLines && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LuCirclePlus />}
                asChild
              >
                <Link to={path.to.pickingListLineNew(id)}>
                  <Trans>Add line</Trans>
                </Link>
              </Button>
            )}
          </HStack>
        </div>

        {lines.length === 0 ? (
          <Empty className="py-10">
            <span className="text-xs text-muted-foreground">
              {t`This picking list has no lines yet.`}
            </span>
          </Empty>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/60">
                <th className="py-2 pl-4 pr-2 w-8" />
                <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Trans>Item</Trans>
                </th>
                <th className="py-2 pr-4 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Trans>From</Trans>
                </th>
                <th className="py-2 pr-4 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Trans>Required</Trans>
                </th>
                <th className="py-2 pr-4 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Trans>Picked</Trans>
                </th>
                <th className="py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Trans>Status</Trans>
                </th>
                <th className="py-2 pr-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const matching = incidents.filter((inc) => {
                  if (inc.itemId && inc.itemId !== line.itemId) return false;
                  if (
                    inc.trackedEntityId &&
                    inc.trackedEntityId !== line.pickedTrackedEntityId
                  )
                    return false;
                  return true;
                });
                return (
                  <LineTableRow
                    key={line.id}
                    line={line}
                    index={index}
                    isEditable={isEditable}
                    canManage={canManageLines}
                    canApprove={canApprove}
                    matchingIncidents={matching}
                    isActive={line.id === activeLineId}
                    onPick={onPick}
                    onUnpick={onUnpick}
                    onScan={onScan}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onSelect={onSelectLine}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </VStack>
  );
};

export default PickingListLines;
