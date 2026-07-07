import type { Database } from "@carbon/database";
import { Status, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type MakeMethodVersionStatusProps = {
  status?: Database["public"]["Enums"]["makeMethodStatus"];
  isActive?: boolean;
};

const MakeMethodVersionStatus = ({
  status,
  isActive
}: MakeMethodVersionStatusProps) => {
  let badge: JSX.Element | null = null;

  switch (status) {
    case "Draft":
      badge = (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
      break;
    case "Active":
      badge = (
        <Status color="green">
          <Trans>Active</Trans>
        </Status>
      );
      break;
    case "Archived":
      badge = (
        <Status color="orange">
          <Trans>Archived</Trans>
        </Status>
      );
      break;
    default:
      return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help">{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <Trans>
          Draft = editable · Active = read-only (create a new version to change)
          · Archived = history
        </Trans>
      </TooltipContent>
    </Tooltip>
  );
};

export default MakeMethodVersionStatus;
