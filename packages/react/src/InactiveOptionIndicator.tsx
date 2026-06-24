import { LuCircleSlash } from "react-icons/lu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import { cn } from "./utils/cn";

// Trailing red indicator shown on a greyed-out (disabled) select option. The
// icon is its own tooltip trigger so it never conflicts with the label's
// truncation tooltip. Used by the searchable select primitives below.
function InactiveOptionIndicator({
  reason,
  className
}: {
  reason?: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "ml-auto flex-shrink-0 text-muted-foreground",
            className
          )}
        >
          <LuCircleSlash className="h-4 w-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason ?? "Unavailable"}</TooltipContent>
    </Tooltip>
  );
}

export { InactiveOptionIndicator };
