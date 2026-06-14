import {
  BarProgress,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Count,
  cn,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuCirclePlus, LuQrCode, LuUndo2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Empty, ItemThumbnail } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions } from "~/hooks";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { isPickingListLocked } from "../../inventory.models";
import type {
  getPickingList,
  getPickingListLines
} from "../../inventory.service";
import { ShortPickModal } from "./ShortPickModal";

type PickingListData = NonNullable<
  Awaited<ReturnType<typeof getPickingList>>["data"]
>;

type PickingListLineData = NonNullable<
  Awaited<ReturnType<typeof getPickingListLines>>["data"]
>;

type PickingListLinesProps = {
  pickingListLines: PickingListLineData;
  pickingListId: string;
  pickingList: PickingListData;
};

// A "kit" is the box a kitter fills for one job operation. Parts must not be
// mixed across operations, so lines are grouped by job operation — the job +
// operation + work center identify the box.
type Kit = {
  key: string;
  jobReadableId: string | null;
  operationName: string | null;
  workCenterName: string | null;
  lines: PickingListLineData;
};

const PickingListLines = ({
  pickingListLines,
  pickingListId,
  pickingList
}: PickingListLinesProps) => {
  const isLocked = isPickingListLocked(pickingList?.status);
  const kits = useMemo(() => {
    const groups = new Map<string, Kit>();
    for (const line of pickingListLines) {
      const key = line.jobOperationId ?? "ungrouped";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          jobReadableId: line.job?.jobId ?? null,
          operationName: line.jobOperation?.process?.name ?? null,
          workCenterName: line.jobOperation?.workCenter?.name ?? null,
          lines: []
        });
      }
      groups.get(key)!.lines.push(line);
    }
    return Array.from(groups.values()).sort((a, b) => {
      const job = (a.jobReadableId ?? "").localeCompare(b.jobReadableId ?? "");
      if (job !== 0) return job;
      return (a.operationName ?? "").localeCompare(b.operationName ?? "");
    });
  }, [pickingListLines]);

  if (kits.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Picking Lines</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg">
            <Empty className="py-6" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <VStack spacing={4} className="w-full">
      {kits.map((kit) => (
        <PickingKitCard
          key={kit.key}
          kit={kit}
          pickingListId={pickingListId}
          isLocked={isLocked}
        />
      ))}
    </VStack>
  );
};

function PickingKitCard({
  kit,
  pickingListId,
  isLocked
}: {
  kit: Kit;
  pickingListId: string;
  isLocked: boolean;
}) {
  const totalToPick = kit.lines.reduce(
    (sum, l) => sum + Number(l.quantityToPick ?? 0),
    0
  );
  const totalPicked = kit.lines.reduce(
    (sum, l) =>
      sum +
      Math.min(Number(l.quantityPicked ?? 0), Number(l.quantityToPick ?? 0)),
    0
  );
  const progress = totalToPick > 0 ? (totalPicked / totalToPick) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {kit.jobReadableId ?? "Unknown Job"}
          {kit.operationName ? ` · ${kit.operationName}` : ""}
        </CardTitle>
        {kit.workCenterName && (
          <CardDescription>
            <Enumerable value={kit.workCenterName} />
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <BarProgress progress={progress} className="mb-4" />
        <div className="border rounded-lg">
          {kit.lines.map((line, index) => (
            <PickingListLineItem
              key={line.id}
              line={line}
              pickingListId={pickingListId}
              isLast={index === kit.lines.length - 1}
              isLocked={isLocked}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PickingListLineItem({
  line,
  pickingListId,
  isLast,
  isLocked
}: {
  line: PickingListLineData[number];
  pickingListId: string;
  isLast: boolean;
  isLocked: boolean;
}) {
  const permissions = usePermissions();
  const [items] = useItems();
  const fetcher = useFetcher<{ success: boolean; message?: string }>();
  const isPending = fetcher.state !== "idle";
  const [shortOpen, setShortOpen] = useState(false);

  useEffect(() => {
    if (fetcher.data && fetcher.data.success === false) {
      toast.error(fetcher.data.message ?? "Failed to pick line");
    }
  }, [fetcher.data]);

  const item = items.find((i) => i.id === line.itemId);
  const itemName = item?.name ?? line.item?.name ?? "";
  const quantityToPick = Number(line.quantityToPick ?? 0);
  const quantityPicked = Number(line.quantityPicked ?? 0);
  const isPicked = quantityToPick > 0 && quantityPicked >= quantityToPick;
  const isShort = line.status === "Short";
  const isResolved = isPicked || isShort;
  const isTracked =
    item?.itemTrackingType === "Serial" || item?.itemTrackingType === "Batch";
  const source = (line as { storageUnit?: { name?: string } }).storageUnit
    ?.name;
  const canPick = permissions.can("update", "inventory");

  const pick = (quantity: number) => {
    const formData = new FormData();
    formData.append("pickingListLineId", line.id);
    formData.append("quantity", String(quantity));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.pickingListLineQuantity(pickingListId)
    });
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-6 p-4 border-b transition-opacity duration-150",
        isLast && "border-none",
        isResolved && "opacity-50 hover:opacity-100"
      )}
    >
      <HStack spacing={4} className="min-w-0 flex-1">
        <ItemThumbnail
          size="md"
          thumbnailPath={null}
          type={(item?.type as "Part") ?? "Part"}
        />
        <VStack spacing={0} className="min-w-0">
          <p className="text-sm font-medium truncate">{itemName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {item?.readableIdWithRevision ?? line.item?.readableId}
          </p>
        </VStack>
      </HStack>

      <HStack spacing={6} className="shrink-0">
        {source && (
          <div className="text-base font-medium whitespace-nowrap">
            {source}
          </div>
        )}
        <Count
          count={isShort ? quantityPicked : quantityToPick}
          className={cn(
            "text-white text-base tabular-nums",
            isPicked
              ? "bg-emerald-600"
              : isShort
                ? "bg-orange-500"
                : "bg-red-600"
          )}
        />
        {isLocked ? null : isTracked ? (
          <Button variant="secondary" leftIcon={<LuQrCode />} isDisabled>
            <Trans>Scan</Trans>
          </Button>
        ) : isPicked ? (
          <Button
            variant="secondary"
            leftIcon={<LuUndo2 />}
            isDisabled={!canPick || isPending}
            isLoading={isPending}
            onClick={() => pick(0)}
          >
            <Trans>Unpick</Trans>
          </Button>
        ) : (
          <HStack spacing={1}>
            <Button
              variant="secondary"
              isDisabled={!canPick || isPending}
              onClick={() => setShortOpen(true)}
            >
              <Trans>Short</Trans>
            </Button>
            <Button
              leftIcon={<LuCirclePlus />}
              isDisabled={!canPick || isPending}
              isLoading={isPending}
              onClick={() => pick(quantityToPick)}
            >
              <Trans>Pick</Trans>
            </Button>
          </HStack>
        )}
      </HStack>

      {shortOpen && (
        <ShortPickModal
          pickingListId={pickingListId}
          lineId={line.id}
          itemName={itemName}
          quantityToPick={quantityToPick}
          quantityPicked={quantityPicked}
          onClose={() => setShortOpen(false)}
        />
      )}
    </div>
  );
}

export default PickingListLines;
