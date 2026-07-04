import { cn } from "@carbon/react";
import type { ComponentProps, ReactNode } from "react";
import { AiOutlinePartition } from "react-icons/ai";
import ItemRevisionStatus from "../Item/ItemRevisionStatus";

// Before/After revision cell: item id + a lifecycle status badge whose tooltip
// explains what the stage (Design/Prototype/Production/Obsolete) means.
export default function RevisionCell({
  label,
  id,
  status,
  highlight = false
}: {
  label: ReactNode;
  id: string | null;
  status?: string | null;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <AiOutlinePartition className="size-4 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "font-semibold",
            highlight && "text-emerald-600 dark:text-emerald-400"
          )}
        >
          {id}
        </span>
        {status ? (
          <ItemRevisionStatus
            status={
              status as ComponentProps<typeof ItemRevisionStatus>["status"]
            }
            withHelp
          />
        ) : null}
      </div>
    </div>
  );
}
