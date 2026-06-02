import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Count,
  cn,
  HStack,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useMemo } from "react";
import { Outlet, useNavigate } from "react-router";
import { Empty } from "~/components";
import { path } from "~/utils/path";
import type {
  getPickingList,
  getPickingListLines
} from "../../inventory.service";

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

type GroupedLines = {
  jobOperationId: string;
  jobId: string;
  jobReadableId: string | null;
  operationOrder: number | null;
  processName: string | null;
  workCenterName: string | null;
  lines: PickingListLineData;
};

const PickingListLines = ({
  pickingListLines,
  pickingListId,
  pickingList
}: PickingListLinesProps) => {
  const groupedLines = useMemo(() => {
    const groups = new Map<string, GroupedLines>();

    for (const line of pickingListLines) {
      const opId = line.jobOperationId ?? "unassigned";
      if (!groups.has(opId)) {
        groups.set(opId, {
          jobOperationId: opId,
          jobId: line.jobId ?? "",
          jobReadableId: line.job?.jobId ?? null,
          operationOrder: line.jobOperation?.order ?? null,
          processName: line.jobOperation?.process?.name ?? null,
          workCenterName: line.jobOperation?.workCenter?.name ?? null,
          lines: []
        });
      }
      groups.get(opId)!.lines.push(line);
    }

    return Array.from(groups.values()).sort((a, b) => {
      const jobCmp = (a.jobReadableId ?? "").localeCompare(
        b.jobReadableId ?? ""
      );
      if (jobCmp !== 0) return jobCmp;
      return (a.operationOrder ?? 0) - (b.operationOrder ?? 0);
    });
  }, [pickingListLines]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-row items-center gap-2">
            <Trans>Picking Lines</Trans>
            {pickingListLines.length > 0 && (
              <Count count={pickingListLines.length} />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6">
            {groupedLines.length > 0 ? (
              groupedLines.map((group) => (
                <PickingListLineGroup
                  key={group.jobOperationId}
                  group={group}
                  pickingListId={pickingListId}
                />
              ))
            ) : (
              <div className="flex flex-1 py-24 justify-center items-center w-full">
                <Empty />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

function PickingListLineGroup({
  group,
  pickingListId
}: {
  group: GroupedLines;
  pickingListId: string;
}) {
  return (
    <div className="border rounded-lg">
      <div className="flex items-center gap-4 p-4 border-b bg-muted/50">
        <HStack spacing={4}>
          <span className="text-sm font-medium">
            {group.jobReadableId ?? "Unknown Job"}
          </span>
          {group.processName && (
            <Badge variant="secondary">
              Op {group.operationOrder} - {group.processName}
            </Badge>
          )}
          {group.workCenterName && (
            <Badge variant="outline">{group.workCenterName}</Badge>
          )}
        </HStack>
      </div>

      {group.lines.map((line, index) => (
        <PickingListLineItem
          key={line.id}
          line={line}
          pickingListId={pickingListId}
          className={index === group.lines.length - 1 ? "border-none" : ""}
        />
      ))}
    </div>
  );
}

function PickingListLineItem({
  line,
  pickingListId,
  className
}: {
  line: PickingListLineData[number];
  pickingListId: string;
  className?: string;
}) {
  const navigate = useNavigate();

  const quantityToPick = Number(line.quantityToPick ?? 0);
  const quantityPicked = Number(line.quantityPicked ?? 0);

  return (
    <div
      className={cn("border-b p-4 hover:bg-muted/30 cursor-pointer", className)}
      onClick={() => {
        if (line.id) {
          navigate(path.to.pickingListLine(pickingListId, line.id));
        }
      }}
    >
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="flex-1">
          <VStack spacing={0}>
            <span className="text-sm font-medium">
              {line.item?.readableId ?? "Unknown"} - {line.item?.name ?? ""}
            </span>
            {line.storageUnit?.name && (
              <span className="text-xs text-muted-foreground">
                {line.storageUnit.name}
              </span>
            )}
          </VStack>
        </HStack>

        <HStack spacing={4}>
          <div className="text-sm text-right">
            <span className="font-medium">
              {quantityPicked.toLocaleString()}
            </span>
            <span className="text-muted-foreground">
              {" "}
              / {quantityToPick.toLocaleString()}
            </span>
          </div>
          <PickingLineStatus status={line.status ?? "Pending"} />
        </HStack>
      </div>
    </div>
  );
}

function PickingLineStatus({ status }: { status: string }) {
  switch (status) {
    case "Picked":
      return <Badge variant="green">{status}</Badge>;
    case "Short":
      return <Badge variant="yellow">{status}</Badge>;
    case "Cancelled":
      return <Badge variant="destructive">{status}</Badge>;
    case "Pending":
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default PickingListLines;
