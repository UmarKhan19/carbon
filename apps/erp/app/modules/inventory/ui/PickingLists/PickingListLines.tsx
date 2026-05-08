import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
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
  LuChevronDown,
  LuChevronUp,
  LuCircleCheck,
  LuPencil,
  LuPlus,
  LuQrCode,
  LuTrash,
  LuUndo2,
  LuWarehouse
} from "react-icons/lu";
import { useFetcher, useNavigate, useParams } from "react-router";
import { Empty, ItemThumbnail, TrackingTypeIcon } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { PickingListDetail, PickingListLine } from "~/modules/inventory";
import { path } from "~/utils/path";
import PickingListStatCards from "./PickingListStatCards";

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
  isEditable: boolean;
  canApprove: boolean;
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
  isEditable,
  canApprove,
  allocatedElsewhere,
  matchingIncidents,
  onPick,
  onUnpick,
  onScan,
  onEdit,
  onDelete
}: PickingListLineRowProps) {
  const [qty, setQty] = useState<number>(line.pickedQuantity ?? 0);
  const item = (line as any).item;
  const storageUnit = (line as any).storageUnit;
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

    // Tier 1: above hard block (2x) -> approver override path or full block.
    if (required > 0 && n > hardBlockAt) {
      if (!canApprove) {
        window.alert(
          `Cannot pick ${n} ${uom}: exceeds 2x the required quantity (${hardBlockAt}). Approver override required.`
        );
        setQty(line.pickedQuantity ?? 0);
        return;
      }
      const ok = window.confirm(
        `Approver override: pick ${n} ${uom}? This is more than 2x the required ${required} ${uom}.`
      );
      if (!ok) {
        setQty(line.pickedQuantity ?? 0);
        return;
      }
      onPick(line, n, true);
      return;
    }

    // Tier 2: above soft tolerance but <= 2x -> confirm.
    if (required > 0 && n > warnAt) {
      const ok = window.confirm(
        `Picking ${n} ${uom} exceeds the required ${required} by more than ${tolerance}%. Continue?`
      );
      if (!ok) {
        setQty(line.pickedQuantity ?? 0);
        return;
      }
    }
    onPick(line, n);
  };

  return (
    <div
      className={cn(
        "flex flex-col border-b p-4 gap-3 last:border-none",
        isPicked && "bg-muted/30"
      )}
    >
      <div className="flex justify-between items-start">
        <HStack spacing={3} className="flex-1">
          <ItemThumbnail
            size="md"
            thumbnailPath={item?.thumbnailPath}
            type={(item?.type as "Part") ?? "Part"}
          />
          <VStack spacing={1} className="min-w-0">
            <span className="text-sm font-medium">{item?.name}</span>
            <span className="text-xs text-muted-foreground">
              {item?.readableId}
            </span>
            {storageUnit && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <LuWarehouse className="h-3 w-3" />
                {storageUnit.name}
              </span>
            )}
            <HStack spacing={1} className="mt-1.5 flex-wrap items-center">
              {line.requiresBatchTracking && (
                <Badge variant="secondary" className="text-xs w-fit h-6 px-2">
                  <TrackingTypeIcon type="Batch" className="mr-1" />
                  <Trans>Batch</Trans>
                </Badge>
              )}
              {line.requiresSerialTracking && (
                <Badge variant="secondary" className="text-xs w-fit h-6 px-2">
                  <TrackingTypeIcon type="Serial" className="mr-1" />
                  <Trans>Serial</Trans>
                </Badge>
              )}
              {allocatedElsewhere > 0 && (
                <Badge
                  variant="outline"
                  className="text-xs w-fit h-6 px-2 text-amber-600 border-amber-300"
                >
                  {allocatedElsewhere} {line.unitOfMeasureCode}{" "}
                  <Trans>in other PLs</Trans>
                </Badge>
              )}
            </HStack>
          </VStack>
        </HStack>

        <HStack spacing={3} className="items-center">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">
              <Trans>Required</Trans>
            </div>
            {line.adjustedQuantity != null && matchingIncidents.length > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    <div className="text-sm font-medium line-through text-muted-foreground">
                      {line.estimatedQuantity} {line.unitOfMeasureCode}
                    </div>
                    <div className="text-sm font-medium text-orange-500">
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
            ) : (
              <>
                <div
                  className={cn(
                    "text-sm font-medium",
                    line.adjustedQuantity != null &&
                      "line-through text-muted-foreground"
                  )}
                >
                  {line.estimatedQuantity} {line.unitOfMeasureCode}
                </div>
                {line.adjustedQuantity != null && (
                  <div className="text-sm font-medium text-orange-500">
                    {line.adjustedQuantity} {line.unitOfMeasureCode}
                  </div>
                )}
              </>
            )}
          </div>

          {isEditable && (
            <div className="flex items-center gap-1">
              {isTracked ? (
                <Button
                  size="sm"
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
                <div className="flex items-center gap-2">
                  <NumberField
                    value={qty}
                    onChange={(value) =>
                      setQty(Number.isFinite(value) ? value : 0)
                    }
                  >
                    <NumberInputGroup className="relative">
                      <NumberInput
                        className="w-[86px] [&_input]:text-center"
                        size="sm"
                        min={0}
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
                  <span className="text-xs text-muted-foreground">
                    {line.unitOfMeasureCode}
                  </span>
                </div>
              )}

              {isPicked && (
                <IconButton
                  aria-label="Unpick"
                  icon={<LuUndo2 />}
                  variant="ghost"
                  size="sm"
                  onClick={() => onUnpick(line)}
                />
              )}

              <IconButton
                aria-label="Edit line"
                icon={<LuPencil />}
                variant="ghost"
                size="sm"
                onClick={() => onEdit(line)}
              />

              {!isPicked && (
                <IconButton
                  aria-label="Delete line"
                  icon={<LuTrash />}
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(line)}
                />
              )}
            </div>
          )}

          {!isEditable && (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">
                <Trans>Picked</Trans>
              </div>
              <div
                className={cn(
                  "text-sm font-medium",
                  isPicked ? "text-green-600" : "text-muted-foreground"
                )}
              >
                {line.pickedQuantity ?? 0} {line.unitOfMeasureCode}
              </div>
            </div>
          )}

          {isPicked && (
            <LuCircleCheck className="text-green-500 h-4 w-4 flex-shrink-0" />
          )}
        </HStack>
      </div>

      {line.pickedTrackedEntityId && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-12">
          <LuQrCode className="h-3 w-3" />
          {line.pickedTrackedEntityId}
        </div>
      )}

      {(line.outstandingQuantity ?? 0) > 0 && (
        <div className="ml-12 text-xs text-orange-500">
          <Trans>Outstanding:</Trans> {line.outstandingQuantity}{" "}
          {line.unitOfMeasureCode}
        </div>
      )}

      {(line.overPickQuantity ?? 0) > 0 && (
        <div className="ml-12 text-xs text-red-500">
          <Trans>Overpick:</Trans> {line.overPickQuantity}{" "}
          {line.unitOfMeasureCode}
        </div>
      )}

      {isProperQuantity && (
        <div className="ml-12 text-xs text-green-500">
          <Trans>Proper quantity:</Trans> {line.pickedQuantity ?? 0}{" "}
          {line.unitOfMeasureCode}
        </div>
      )}
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

  // Soft allocation: fetch outstanding qty for these items across other active PLs
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
    <>
      <PickingListStatCards lines={lines} dueDate={pl?.dueDate ?? null} />
      <Card>
        <CardHeader>
          <HStack className="justify-between">
            <CardTitle>
              <Trans>Lines</Trans>
              {lines.length > 0 && (
                <span className="ml-2 text-muted-foreground font-normal text-sm">
                  {pickedCount}/{lines.length} <Trans>picked</Trans>
                </span>
              )}
            </CardTitle>
            {canManageLines && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<LuPlus />}
                onClick={() => navigate(path.to.pickingListLineNew(id))}
              >
                <Trans>Add Line</Trans>
              </Button>
            )}
          </HStack>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <Empty className="py-6">
              <span className="text-xs text-muted-foreground">
                {t`This picking list has no lines yet.`}
              </span>
            </Empty>
          ) : (
            lines.map((line) => {
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
                  isEditable={isEditable}
                  canApprove={canApprove}
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
        </CardContent>
      </Card>
    </>
  );
};

export default PickingListLines;
