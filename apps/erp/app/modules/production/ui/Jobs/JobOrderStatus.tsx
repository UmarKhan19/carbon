import {
  PulsingDot,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCircleCheck } from "react-icons/lu";
import { AlmostDoneIcon } from "~/assets/icons/AlmostDoneIcon";
import { InProgressStatusIcon } from "~/assets/icons/InProgressStatusIcon";
import { TodoStatusIcon } from "~/assets/icons/TodoStatusIcon";
import type { ItemOrderStatus } from "../../jobOrderStatus";

// Precedence: in-flight POs first, then the needs-ordering dot, then a
// fully-received / closed PO. getJobOrderStatusCategory must mirror this.
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

  switch (status?.status) {
    case "Planned":
      return badge(
        <TodoStatusIcon className="text-blue-600" />,
        <Trans>Planned purchase order</Trans>
      );
    case "Needs Approval":
    case "To Review":
      return badge(<InProgressStatusIcon />, <Trans>Awaiting approval</Trans>);
    case "To Receive":
    case "To Receive and Invoice": {
      const fraction =
        status.ordered > 0 ? status.received / status.ordered : 0;
      // In-flight (not yet fully received) outranks the needs-ordering dot.
      if (fraction < 1) {
        return status.received > 0
          ? badge(<AlmostDoneIcon />, <Trans>Receiving</Trans>)
          : badge(<AlmostDoneIcon />, <Trans>On order</Trans>);
      }
      break;
    }
  }

  // A still-unmet shortfall outranks a fully-received / closed PO.
  if (status?.needsOrder) {
    return (
      <Tooltip>
        <TooltipTrigger className="flex w-5 items-center justify-center">
          <PulsingDot />
        </TooltipTrigger>
        <TooltipContent>
          <Trans>Order {status.shortfall} for this job</Trans>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (
    status?.status === "To Receive" ||
    status?.status === "To Receive and Invoice" ||
    status?.status === "To Invoice" ||
    status?.status === "Completed"
  ) {
    return badge(
      <LuCircleCheck className="text-emerald-600" />,
      <Trans>Received</Trans>
    );
  }

  return null;
}
