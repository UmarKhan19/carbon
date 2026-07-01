import { cn } from "@carbon/react";
import {
  LuAtom,
  LuCalendar,
  LuHash,
  LuList,
  LuToggleLeft,
  LuType
} from "react-icons/lu";
import type { BatchPropertyDataType } from "./types";

export function ConfiguratorDataTypeIcon({
  type,
  className
}: {
  type: BatchPropertyDataType;
  className?: string;
}) {
  switch (type) {
    case "numeric":
      return <LuHash className={cn("w-4 h-4 text-status-blue", className)} />;
    case "text":
      return <LuType className={cn("w-4 h-4 text-status-green", className)} />;
    case "boolean":
      return (
        <LuToggleLeft className={cn("w-4 h-4 text-status-purple", className)} />
      );
    case "enum":
    case "list":
      return <LuList className={cn("w-4 h-4 text-status-orange", className)} />;
    case "date":
      return (
        <LuCalendar className={cn("w-4 h-4 text-status-red", className)} />
      );
    case "material":
      return <LuAtom className={cn("w-4 h-4 text-status-yellow", className)} />;
    default:
      return null;
  }
}
