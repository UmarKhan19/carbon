import { BarProgress, cn } from "@carbon/react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

type JobOperationNodeData = {
  description: string;
  itemId: string | null;
  status: string;
  quantityComplete: number;
  targetQuantity: number;
  quantityReworked: number;
  quantityScrapped: number;
  direction: "LR" | "TB";
};

const STATUS_COLORS: Record<string, { border: string; bar: string }> = {
  Done: { border: "border-success", bar: "bg-success" },
  "In Progress": { border: "border-info", bar: "bg-info" },
  Ready: { border: "border-status-green", bar: "bg-status-green" },
  Waiting: { border: "border-border", bar: "bg-muted-foreground" },
  Todo: { border: "border-border", bar: "bg-muted" },
  Paused: { border: "border-warning", bar: "bg-warning" },
  Canceled: { border: "border-destructive", bar: "bg-destructive" }
};

function JobOperationNodeImpl({ data }: NodeProps) {
  const d = data as unknown as JobOperationNodeData;
  const colors = STATUS_COLORS[d.status] ?? STATUS_COLORS.Todo;
  const isHorizontal = d.direction === "LR";

  return (
    <>
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        className="invisible"
      />
      <div
        className={cn(
          "w-[200px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm",
          colors.border
        )}
      >
        {d.itemId && (
          <div className="truncate text-[11px] text-muted-foreground leading-tight">
            {d.itemId}
          </div>
        )}
        <div className="truncate text-sm font-medium leading-tight">
          {d.description}
        </div>
        <BarProgress
          segments={[
            { value: d.quantityComplete, className: "bg-success" },
            { value: d.quantityReworked, className: "bg-warning" },
            { value: d.quantityScrapped, className: "bg-destructive" }
          ]}
          progress={d.quantityComplete}
          max={d.targetQuantity || 1}
          value={`${d.quantityComplete}/${d.targetQuantity}`}
          className="mt-1"
        />
        {d.quantityScrapped > 0 && (
          <div className="mt-0.5 text-right text-[11px] text-status-red">
            {d.quantityScrapped} scrapped
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        className="invisible"
      />
    </>
  );
}

export const JobOperationNode = memo(JobOperationNodeImpl);
