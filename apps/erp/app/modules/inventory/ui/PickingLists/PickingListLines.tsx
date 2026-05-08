import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  LuArrowRight,
  LuChevronDown,
  LuChevronUp,
  LuCirclePlus,
  LuEllipsisVertical,
  LuPencilLine,
  LuQrCode,
  LuTrash,
  LuUndo2
} from "react-icons/lu";
import { Link, useFetcher, useNavigate, useParams } from "react-router";
import { Empty, ItemThumbnail, TrackingTypeIcon } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions, useRouteData } from "~/hooks";
import type { PickingListDetail, PickingListLine } from "~/modules/inventory";
import { path } from "~/utils/path";

type IncidentTooltipRow = {
  id: string;
  incidentId: string | null;
  itemId: string | null;
  trackedEntityId: string | null;
  quantityLost: number;
  incidentDate: string;
  incidentType: { name: string } | null;
};

interface PickingListLineRowProps {
  line: PickingListLine;
  index: number;
  totalLines: number;
  isEditable: boolean;
  canApprove: boolean;
  canManage: boolean;
  allocatedElsewhere: number;
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

function PickingListLineRow({
  line,
  index,
  totalLines,
  isEditable,
  canApprove,
  canManage,
  allocatedElsewhere,
  matchingIncidents,
  onPick,
  onUnpick,
  onScan,
  onEdit,
  onDelete
}: PickingListLineRowProps) {
  const { t } = useLingui();
  const unitsOfMeasure = useUnitOfMeasure();
  const [qty, setQty] = useState<number>(line.pickedQuantity ?? 0);

  const item = (line as any).item;
  const storageUnit = (line as any).storageUnit;
  const destinationStorageUnit = (line as any).destinationStorageUnit;
  const isTracked = line.requiresBatchTracking || line.requiresSerialTracking;
  const isPicked = (line.pickedQuantity ?? 0) > 0;
  const requiredQuantity = line.adjustedQuantity ?? line.estimatedQuantity ?? 0;
  const isProperQuantity =
    isPicked &&
    (line.outstandingQuantity ?? 0) <= 0 &&
    (line.overPickQuantity ?? 0) <= 0 &&
    (line.pickedQuantity ?? 0) === requiredQuantity;

  useEffect(() => {
    setQty(line.pickedQuantity ?? 0);
  }, [line.pickedQuantity]);

  const handlePickQuantityBlur = () => {
    if (!Number.isFinite(qty) || qty === line.pickedQuantity) return;
    const n = qty;
    const required = requiredQuantity;
    const tolerance = (line as any).overpickTolerancePercent ?? 2;
    const warnAt = required * (1 + tolerance / 100);
    const hardBlockAt = required * 2;
    const uom = line.unitOfMeasureCode ?? "";

    if (required > 0 && n > hardBlockAt) {
      if (!canApprove) {
        window.alert(
          t`Cannot pick ${n} ${uom}: exceeds 2x the required quantity (${hardBlockAt}). Approver override required.`
        );
        setQty(line.pickedQuantity ?? 0);
        return;
      }
      const ok = window.confirm(
        t`Approver override: pick ${n} ${uom}? This is more than 2x the required ${required} ${uom}.`
      );
      if (!ok) {
        setQty(line.pickedQuantity ?? 0);
        return;
      }
      onPick(line, n, true);
      return;
    }

    if (required > 0 && n > warnAt) {
      const ok = window.confirm(
        t`Picking ${n} ${uom} exceeds the required ${required} by more than ${tolerance}%. Continue?`
      );
      if (!ok) {
        setQty(line.pickedQuantity ?? 0);
        return;
      }
    }
    onPick(line, n);
  };

  const uomLabel =
    unitsOfMeasure?.find((u) => u.value === line.unitOfMeasureCode)?.label ??
    line.unitOfMeasureCode ??
    null;

  return (
    <div
      className={cn(
        "flex justify-between items-center w-full p-6 gap-6 border-b",
        index === totalLines - 1 && "border-none",
        isPicked && "opacity-60 hover:opacity-100"
      )}
    >
      <HStack spacing={4} className="w-1/2 justify-between">
        <HStack spacing={4} className="min-w-0">
          <ItemThumbnail
            size="md"
            thumbnailPath={item?.thumbnailPath}
            type={(item?.type as "Part") ?? "Part"}
          />
          <VStack spacing={0} className="max-w-[380px] w-full min-w-0">
            <div className="w-full overflow-hidden">
              <span className="text-sm font-medium truncate block w-full">
                {item?.name}
              </span>
              <span className="text-xs text-muted-foreground truncate block w-full">
                {item?.readableId}
              </span>
              {line.pickedTrackedEntityId && (
                <span className="flex gap-1 text-xs text-muted-foreground items-center w-full truncate">
                  <LuQrCode className="shrink-0" />
                  <span className="truncate">{line.pickedTrackedEntityId}</span>
                </span>
              )}
            </div>
            <HStack spacing={1} className="mt-2 flex-wrap">
              <Enumerable value={uomLabel} />
              {line.requiresBatchTracking && (
                <Badge variant="secondary" className="h-6 px-2">
                  <TrackingTypeIcon type="Batch" className="mr-1" />
                  <Trans>Batch</Trans>
                </Badge>
              )}
              {line.requiresSerialTracking && (
                <Badge variant="secondary" className="h-6 px-2">
                  <TrackingTypeIcon type="Serial" className="mr-1" />
                  <Trans>Serial</Trans>
                </Badge>
              )}
              {allocatedElsewhere > 0 && (
                <Badge color="orange" className="h-6 px-2">
                  {allocatedElsewhere} {line.unitOfMeasureCode}{" "}
                  <Trans>in other PLs</Trans>
                </Badge>
              )}
            </HStack>
          </VStack>
        </HStack>
        <div className="flex flex-col items-end shrink-0">
          <span className="text-xxs uppercase tracking-wide text-muted-foreground/70 font-medium">
            <Trans>Required</Trans>
          </span>
          {line.adjustedQuantity != null && matchingIncidents.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-help text-right">
                  <div className="text-sm font-medium line-through text-muted-foreground tabular-nums">
                    {line.estimatedQuantity} {line.unitOfMeasureCode}
                  </div>
                  <div className="text-base font-semibold text-orange-500 tabular-nums">
                    {line.adjustedQuantity} {line.unitOfMeasureCode}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
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
          ) : line.adjustedQuantity != null ? (
            <div className="text-right">
              <div className="text-xs font-medium line-through text-muted-foreground tabular-nums">
                {line.estimatedQuantity} {line.unitOfMeasureCode}
              </div>
              <div className="text-base font-semibold text-orange-500 tabular-nums">
                {line.adjustedQuantity} {line.unitOfMeasureCode}
              </div>
            </div>
          ) : (
            <div className="text-base font-semibold tabular-nums">
              {line.estimatedQuantity} {line.unitOfMeasureCode}
            </div>
          )}
          {isProperQuantity && (
            <span className="mt-1 text-xs text-emerald-500 tabular-nums">
              {line.pickedQuantity} {line.unitOfMeasureCode}{" "}
              <Trans>picked</Trans>
            </span>
          )}
          {(line.outstandingQuantity ?? 0) > 0 && (
            <span className="mt-1 text-xs text-orange-500 tabular-nums">
              {line.outstandingQuantity} {line.unitOfMeasureCode}{" "}
              <Trans>outstanding</Trans>
            </span>
          )}
          {(line.overPickQuantity ?? 0) > 0 && (
            <span className="mt-1 text-xs text-red-500 tabular-nums">
              +{line.overPickQuantity} {line.unitOfMeasureCode}{" "}
              <Trans>overpick</Trans>
            </span>
          )}
        </div>
      </HStack>

      <div className="flex flex-grow items-center justify-between gap-4 pl-4 w-1/2">
        <HStack spacing={3} className="text-left items-center min-w-0">
          <span className="text-base font-medium whitespace-nowrap truncate">
            {storageUnit?.name ?? <Trans>Unassigned</Trans>}
          </span>
          {destinationStorageUnit?.name && (
            <>
              <LuArrowRight className="size-4 text-muted-foreground shrink-0" />
              <span className="text-base font-medium whitespace-nowrap truncate">
                {destinationStorageUnit.name}
              </span>
            </>
          )}
        </HStack>

        <HStack spacing={1} className="shrink-0">
          {isEditable && (
            <>
              {isTracked ? (
                <Button
                  variant={line.pickedTrackedEntityId ? "secondary" : "primary"}
                  leftIcon={<LuQrCode />}
                  onClick={() => onScan(line)}
                >
                  {line.pickedTrackedEntityId ? (
                    <Trans>Re-scan</Trans>
                  ) : (
                    <Trans>Scan</Trans>
                  )}
                </Button>
              ) : (
                <NumberField
                  value={qty}
                  onChange={(value) =>
                    setQty(Number.isFinite(value) ? value : 0)
                  }
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
            </>
          )}

          {!isEditable && (
            <div className="text-right">
              <span className="text-xxs uppercase tracking-wide text-muted-foreground/70 font-medium">
                <Trans>Picked</Trans>
              </span>
              <div
                className={cn(
                  "text-base font-semibold tabular-nums",
                  isPicked ? "text-emerald-500" : "text-muted-foreground"
                )}
              >
                {line.pickedQuantity ?? 0} {line.unitOfMeasureCode}
              </div>
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="secondary"
                icon={<LuEllipsisVertical />}
                aria-label={t`Line options`}
                isDisabled={!isEditable && !canManage}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {isEditable && isPicked && (
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
                disabled={!canManage || isPicked}
                destructive
                onClick={() => onDelete(line)}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete Line</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </div>
    </div>
  );
}

const PickingListLines = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    pickingList: PickingListDetail;
    pickingListLines: PickingListLine[];
    incidents?: IncidentTooltipRow[];
  }>(path.to.pickingList(id));

  const pl = routeData?.pickingList;
  const lines = routeData?.pickingListLines ?? [];
  const incidents = routeData?.incidents ?? [];

  const { t } = useLingui();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lines.length]);

  const allocationMap = (allocationFetcher.data?.data ?? []).reduce<
    Record<string, number>
  >((acc, row) => {
    acc[row.itemId] = row.allocatedQuantity;
    return acc;
  }, {});

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

  const onScan = (line: PickingListLine) => {
    navigate(path.to.pickingListScan(id, line.id!));
  };

  const onEdit = (line: PickingListLine) => {
    navigate(path.to.pickingListLine(id, line.id!));
  };

  const onDelete = (line: PickingListLine) => {
    if (!confirm(t`Delete this line?`)) return;
    pickFetcher.submit(
      {},
      { method: "post", action: path.to.pickingListLineDelete(id, line.id!) }
    );
  };

  return (
    <Card>
      <HStack className="justify-between items-center">
        <CardHeader>
          <CardTitle>
            <Trans>Lines</Trans>
          </CardTitle>
          <CardDescription>
            <span className="tabular-nums">
              {pickedCount}/{lines.length} <Trans>lines picked</Trans>
            </span>
            {totals.required > 0 && (
              <span className="text-muted-foreground tabular-nums">
                {" · "}
                {totals.picked}/{totals.required} <Trans>units</Trans>
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardAction>
          {canManageLines && (
            <Button variant="secondary" leftIcon={<LuCirclePlus />} asChild>
              <Link to={path.to.pickingListLineNew(id)}>
                <Trans>Add Line</Trans>
              </Link>
            </Button>
          )}
        </CardAction>
      </HStack>

      <CardContent>
        <div className="border rounded-lg">
          {lines.length === 0 ? (
            <Empty className="py-6">
              <span className="text-xs text-muted-foreground">
                {t`This picking list has no lines yet.`}
              </span>
            </Empty>
          ) : (
            lines.map((line, index) => {
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
                <PickingListLineRow
                  key={line.id}
                  line={line}
                  index={index}
                  totalLines={lines.length}
                  isEditable={isEditable}
                  canApprove={canApprove}
                  canManage={canManageLines}
                  allocatedElsewhere={allocationMap[line.itemId ?? ""] ?? 0}
                  matchingIncidents={matching}
                  onPick={onPick}
                  onUnpick={onUnpick}
                  onScan={onScan}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default PickingListLines;
