import { cn } from "@carbon/react";
import { AiOutlinePartition } from "react-icons/ai";
import {
  LuCalendarClock,
  LuClock,
  LuFlaskConical,
  LuHand,
  LuInfo,
  LuSquare
} from "react-icons/lu";
import { AttemptIcon } from "~/assets/icons/AttemptIcon";
import { TaskIcon } from "~/assets/icons/TaskIcon";

type TaskIconProps = {
  name: string | undefined;
  className?: string;
};

export function GanttIcon({ name, className }: TaskIconProps) {
  if (!name)
    return <LuSquare className={cn(className, "text-muted-foreground")} />;

  switch (name) {
    case "job":
      return <LuCalendarClock className={cn(className, "text-primary")} />;
    case "assembly":
      return (
        <AiOutlinePartition className={cn(className, "text-status-purple")} />
      );
    case "operation":
      return <LuClock className={cn(className, "text-status-blue")} />;
    case "timecard":
      return <TaskIcon className={cn(className, "text-status-yellow")} />;
    case "inspection":
      return <LuFlaskConical className={cn(className, "text-status-green")} />;
    case "attempt":
      return <AttemptIcon className={cn(className, "text-muted-foreground")} />;
    case "wait":
      return <LuClock className={cn(className, "text-status-yellow")} />;
    //log levels
    case "debug":
    case "log":
    case "info":
      return <LuInfo className={cn(className, "text-muted-foreground")} />;
    case "warn":
      return <LuInfo className={cn(className, "text-status-yellow")} />;
    case "error":
      return <LuInfo className={cn(className, "text-status-red")} />;
    case "fatal":
      return <LuHand className={cn(className, "text-status-red")} />;
  }

  return <LuSquare className={cn(className, "text-muted-foreground")} />;
}
