import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCircleAlert, LuCircleCheck, LuClock, LuStamp } from "react-icons/lu";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import {
  getJobOrderStatusCategory,
  type ItemOrderStatus
} from "../../jobOrderStatus";

// The badge is purely presentational: precedence lives entirely in
// getJobOrderStatusCategory (the single source the status filter also reads), and
// this maps the resolved category to an icon + label. The exhaustive switch means
// adding a category without a badge is a compile error — the two can't drift.
export function JobOrderStatusBadge({
  status
}: {
  status: ItemOrderStatus | undefined;
}) {
  const badge = (icon: ReactNode, label: ReactNode) => (
    <Tooltip>
      <TooltipTrigger className="flex w-5 items-center justify-center">
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  const category = getJobOrderStatusCategory(status);

  switch (category) {
    // A finished job and a need met from on-hand stock share the green check;
    // the label distinguishes them.
    case "completed":
      return badge(
        <LuCircleCheck className="text-emerald-600" />,
        status?.jobCompleted ? (
          <Trans>Completed</Trans>
        ) : (
          <Trans>In stock</Trans>
        )
      );
    case "needsOrder":
      return badge(
        <LuCircleAlert className="text-red-500" />,
        <Trans>Order {status?.shortfall} for this job</Trans>
      );
    case "planned":
      return badge(
        <TodoStatusIcon className="text-blue-600" />,
        <Trans>Planned purchase order</Trans>
      );
    case "awaitingApproval":
      return badge(
        <LuStamp className="text-amber-400" />,
        <Trans>Awaiting approval</Trans>
      );
    case "received":
      return badge(
        <InProgressStatusIcon />,
        <Trans>
          Received {status?.received} of {status?.ordered}
        </Trans>
      );
    case "onOrder":
      return badge(<AlmostDoneIcon />, <Trans>On order</Trans>);
    case "plannedJob":
      return badge(
        <LuClock className="text-amber-400" />,
        status?.supplyJobStatus === "Planned" ? (
          <Trans>Planned job</Trans>
        ) : (
          <Trans>Job in progress</Trans>
        )
      );
    case null:
      return null;
    default: {
      // Exhaustiveness guard — a new category must add a case above.
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}
