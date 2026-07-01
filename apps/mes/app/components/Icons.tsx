import type { Database } from "@carbon/database";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { AiOutlinePartition } from "react-icons/ai";
import {
  BsExclamationSquareFill,
  BsFileEarmarkFill,
  BsFileEarmarkPlayFill,
  BsFileExcelFill,
  BsFileImageFill,
  BsFilePdfFill,
  BsFilePptFill,
  BsFileTextFill,
  BsFileWordFill,
  BsFileZipFill
} from "react-icons/bs";
import { FaCodePullRequest } from "react-icons/fa6";
import {
  LuAtom,
  LuBarcode,
  LuBox,
  LuCircleCheck,
  LuCircleX,
  LuClipboardCheck,
  LuClock,
  LuEye,
  LuFlaskConical,
  LuGroup,
  LuHammer,
  LuHeadphones,
  LuHexagon,
  LuImage,
  LuList,
  LuPizza,
  LuQrCode,
  LuShoppingCart,
  LuSquare,
  LuToggleLeft,
  LuUser
} from "react-icons/lu";
import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetOff } from "react-icons/tb";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import type { documentTypes } from "~/services/models";
import type { Operation } from "~/services/types";

type FileIconProps = {
  type: (typeof documentTypes)[number];
  className?: string;
};

const documentIconBaseClase = "w-6 h-6 flex-shrink-0";

export function DeadlineIcon({
  deadlineType,
  overdue
}: {
  deadlineType: Operation["jobDeadlineType"];
  overdue: boolean;
}) {
  switch (deadlineType) {
    case "ASAP":
      return <BsExclamationSquareFill className="text-status-red" />;
    case "Hard Deadline":
      return (
        <HighPriorityIcon className={cn(overdue ? "text-status-red" : "")} />
      );
    case "Soft Deadline":
      return (
        <MediumPriorityIcon className={cn(overdue ? "text-status-red" : "")} />
      );
    case "No Deadline":
      return <LowPriorityIcon />;
    default:
      return null;
  }
}

export const FileIcon = ({ type, className }: FileIconProps) => {
  switch (type) {
    case "Document":
      return (
        <BsFileWordFill
          className={cn(documentIconBaseClase, "text-status-blue", className)}
        />
      );
    case "Spreadsheet":
      return (
        <BsFileExcelFill
          className={cn(documentIconBaseClase, "text-status-green", className)}
        />
      );
    case "Presentation":
      return (
        <BsFilePptFill
          className={cn(documentIconBaseClase, "text-status-orange", className)}
        />
      );
    case "PDF":
      return (
        <BsFilePdfFill
          className={cn(documentIconBaseClase, "text-status-red", className)}
        />
      );
    case "Archive":
      return <BsFileZipFill className={cn(documentIconBaseClase, className)} />;
    case "Text":
      return (
        <BsFileTextFill className={cn(documentIconBaseClase, className)} />
      );
    case "Image":
      return (
        <BsFileImageFill
          className={cn(documentIconBaseClase, "text-status-yellow", className)}
        />
      );
    case "Video":
      return (
        <BsFileEarmarkPlayFill
          className={cn(documentIconBaseClase, "text-status-purple", className)}
        />
      );
    case "Audio":
      return (
        <BsFileEarmarkPlayFill
          className={cn(documentIconBaseClase, "text-status-blue", className)}
        />
      );
    case "Other":
    default:
      return (
        <BsFileEarmarkFill className={cn(documentIconBaseClase, className)} />
      );
  }
};

export const MethodIcon = ({
  type,
  className,
  isKit
}: {
  type: string;
  className?: string;
  isKit?: boolean;
}) => {
  switch (type) {
    case "Method":
      return (
        <AiOutlinePartition className={cn(className, "text-foreground")} />
      );
    case "Purchase to Order":
      return <LuShoppingCart className={cn("text-status-blue", className)} />;
    case "Make to Order":
      return isKit ? (
        <LuHexagon className={cn("text-status-green", className)} />
      ) : (
        <RxCodesandboxLogo className={cn("text-status-green", className)} />
      );
    case "Pull from Inventory":
      return (
        <FaCodePullRequest className={cn("text-status-yellow", className)} />
      );
  }

  return <LuSquare className={cn("text-muted-foreground", className)} />;
};

export const MethodItemTypeIcon = ({
  type,
  className
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Part":
      return <AiOutlinePartition className={className} />;
    case "Material":
      return <LuAtom className={className} />;
    case "Tool":
      return <LuHammer className={className} />;
    case "Consumable":
      return <LuPizza className={className} />;
    case "Service":
      return <LuHeadphones className={className} />;
  }

  return <LuSquare className={cn("text-muted-foreground", className)} />;
};

export function OperationStatusIcon({
  status
}: {
  status: Operation["operationStatus"];
}) {
  const getIcon = () => {
    switch (status) {
      case "Todo":
        return <TodoStatusIcon className="text-foreground" />;
      case "Ready":
        return <TodoStatusIcon className="text-status-blue" />;
      case "Waiting":
      case "Canceled":
        return <LuCircleX className="text-status-red" />;
      case "Done":
        return <LuCircleCheck className="text-status-green" />;
      case "In Progress":
        return <AlmostDoneIcon />;
      case "Paused":
        return <InProgressStatusIcon />;
      default:
        return null;
    }
  };

  const icon = getIcon();
  if (!icon) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{icon}</span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{status}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export const ProcedureStepTypeIcon = ({
  type,
  className
}: {
  type: Database["public"]["Enums"]["procedureStepType"];
  className?: string;
}) => {
  switch (type) {
    case "Task":
      return (
        <LuClipboardCheck className={cn("text-status-yellow", className)} />
      );
    case "Value":
      return <LuQrCode className={cn("text-foreground", className)} />;
    case "Measurement":
      return <LuFlaskConical className={cn("text-status-green", className)} />;
    case "Checkbox":
      return <LuToggleLeft className={cn("text-status-purple", className)} />;
    case "Timestamp":
      return <LuClock className={cn("text-status-blue", className)} />;
    case "Person":
      return <LuUser className={cn("text-status-yellow", className)} />;
    case "List":
      return <LuList className={cn("text-status-orange", className)} />;
    case "File":
      return <LuImage className={cn("text-status-purple", className)} />;
    case "Inspection":
      return <LuEye className={cn("text-status-purple", className)} />;
  }
};

export const TrackingTypeIcon = ({
  type,
  className
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Serial":
      return <LuBarcode className={cn("text-foreground", className)} />;
    case "Batch":
      return <LuGroup className={cn("text-status-green", className)} />;
    case "Inventory":
      return <LuBox className={cn("text-status-blue", className)} />;
    case "Non-Inventory":
      return <TbTargetOff className={cn("text-status-red", className)} />;
    default:
      return <LuSquare className={cn("text-muted-foreground", className)} />;
  }
};
