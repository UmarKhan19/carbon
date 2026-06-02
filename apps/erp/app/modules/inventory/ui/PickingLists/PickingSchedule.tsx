import { Button, Checkbox, HStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { memo, useCallback, useMemo, useState } from "react";
import { LuPackagePlus } from "react-icons/lu";
import { Form } from "react-router";
import { useDateFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";

type PickingScheduleItem = {
  jobOperationId: string;
  jobId: string;
  jobReadableId: string;
  itemId: string;
  itemReadableId: string;
  itemName: string;
  operationOrder: number;
  processName: string | null;
  workCenterId: string | null;
  workCenterName: string | null;
  dueDate: string | null;
  partsToPickCount: number;
  totalQuantityToPick: number;
};

type PickingScheduleProps = {
  data: PickingScheduleItem[];
  locationId: string;
};

const PickingSchedule = memo(({ data, locationId }: PickingScheduleProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const permissions = usePermissions();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sortedData = useMemo(
    () =>
      [...data].sort((a, b) => {
        const dateA = a.dueDate ?? "";
        const dateB = b.dueDate ?? "";
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return (a.jobReadableId ?? "").localeCompare(b.jobReadableId ?? "");
      }),
    [data]
  );

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === sortedData.length) {
        return new Set();
      }
      return new Set(sortedData.map((d) => d.jobOperationId));
    });
  }, [sortedData]);

  const allSelected =
    sortedData.length > 0 && selectedIds.size === sortedData.length;

  if (!locationId) {
    return (
      <div className="flex flex-1 py-24 justify-center items-center w-full">
        <p className="text-muted-foreground">
          <Trans>Select a location to view the picking schedule</Trans>
        </p>
      </div>
    );
  }

  if (sortedData.length === 0) {
    return (
      <div className="flex flex-1 py-24 justify-center items-center w-full">
        <p className="text-muted-foreground">
          <Trans>No operations require picking at this location</Trans>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Form method="post" action={path.to.newPickingList}>
        <input type="hidden" name="locationId" value={locationId} />
        {Array.from(selectedIds).map((id) => (
          <input key={id} type="hidden" name="jobOperationIds[]" value={id} />
        ))}
        <HStack className="justify-end mb-4">
          <Button
            type="submit"
            leftIcon={<LuPackagePlus />}
            isDisabled={
              selectedIds.size === 0 || !permissions.can("create", "inventory")
            }
          >
            <Trans>Generate Picking List</Trans>
          </Button>
        </HStack>
      </Form>

      <div className="border rounded-lg">
        <div className="flex items-center gap-4 p-4 border-b bg-muted/50 text-sm font-medium text-muted-foreground">
          <div className="w-8">
            <Checkbox
              isChecked={allSelected}
              onCheckedChange={toggleAll}
              aria-label={t`Select all`}
            />
          </div>
          <div className="w-24">
            <Trans>Due Date</Trans>
          </div>
          <div className="flex-1">
            <Trans>Job</Trans>
          </div>
          <div className="flex-1">
            <Trans>Operation</Trans>
          </div>
          <div className="flex-1">
            <Trans>Work Center</Trans>
          </div>
          <div className="w-24 text-right">
            <Trans>Parts</Trans>
          </div>
          <div className="w-32 text-right">
            <Trans>Total Qty</Trans>
          </div>
        </div>

        {sortedData.map((item) => (
          <div
            key={item.jobOperationId}
            className="flex items-center gap-4 p-4 border-b last:border-none hover:bg-muted/30 cursor-pointer"
            onClick={() => toggleSelection(item.jobOperationId)}
          >
            <div className="w-8">
              <Checkbox
                isChecked={selectedIds.has(item.jobOperationId)}
                onCheckedChange={() => toggleSelection(item.jobOperationId)}
                aria-label={t`Select ${item.jobReadableId}`}
              />
            </div>
            <div className="w-24 text-sm">
              {item.dueDate ? formatDate(item.dueDate) : "N/A"}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{item.jobReadableId}</div>
              <div className="text-xs text-muted-foreground">
                {item.itemReadableId} - {item.itemName}
              </div>
            </div>
            <div className="flex-1 text-sm">
              {item.processName ?? "N/A"} (Op {item.operationOrder})
            </div>
            <div className="flex-1 text-sm">{item.workCenterName ?? "N/A"}</div>
            <div className="w-24 text-right text-sm">
              {Number(item.partsToPickCount).toLocaleString()}
            </div>
            <div className="w-32 text-right text-sm">
              {Number(item.totalQuantityToPick).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

PickingSchedule.displayName = "PickingSchedule";
export default PickingSchedule;
