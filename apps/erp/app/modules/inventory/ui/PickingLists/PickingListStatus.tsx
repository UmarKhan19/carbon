import { Badge } from "@carbon/react";
import type { pickingListStatusType } from "../../inventory.models";

type PickingListStatusValue = (typeof pickingListStatusType)[number];

const STATUS_VARIANT: Record<
  PickingListStatusValue,
  "gray" | "purple" | "blue" | "green"
> = {
  Draft: "gray",
  Released: "purple",
  "In Progress": "blue",
  Confirmed: "green",
  Cancelled: "gray"
};

interface PickingListStatusProps {
  status: PickingListStatusValue;
}

export default function PickingListStatus({ status }: PickingListStatusProps) {
  return <Badge variant={STATUS_VARIANT[status] ?? "gray"}>{status}</Badge>;
}
