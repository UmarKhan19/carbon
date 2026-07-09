import { Status } from "@carbon/react";
import type { ChangeOrderStatus as ChangeOrderStatusType } from "../../types";

// Stage → badge color. Done is success (green); the terminal-but-open stages
// step through gray → blue → yellow → orange as work progresses.
const CHANGE_ORDER_STATUS_COLOR_MAP: Record<
  string,
  "green" | "orange" | "red" | "yellow" | "blue" | "gray" | "purple"
> = {
  Draft: "gray",
  Start: "blue",
  "Engineering Complete": "yellow",
  Implementation: "orange",
  Done: "green"
};

type ChangeOrderStatusProps = {
  status?: ChangeOrderStatusType | null;
};

const ChangeOrderStatus = ({ status }: ChangeOrderStatusProps) => {
  if (!status) return null;
  const color = CHANGE_ORDER_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default ChangeOrderStatus;
