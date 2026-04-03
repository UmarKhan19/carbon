import { cn } from "@carbon/react";

export const toggleGroupClass =
  "flex w-full gap-0 rounded-lg border border-border bg-muted p-0.5";

export const toggleItemClass = cn(
  "h-8 flex-1 basis-0 whitespace-nowrap rounded-md px-3 text-sm font-medium",
  "bg-transparent text-muted-foreground",
  "hover:bg-active hover:text-active-foreground",
  "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm",
  "transition-all duration-150"
);
