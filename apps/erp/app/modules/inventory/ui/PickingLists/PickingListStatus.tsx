import type { pickingListStatusType } from "../../inventory.models";

type PickingListStatusValue = (typeof pickingListStatusType)[number];

const STATUS_STYLE: Record<PickingListStatusValue, string> = {
  Draft:
    "inline-flex items-center px-2 py-0.5 rounded-md border border-white/20 text-xs font-medium bg-white/5 text-white/75",
  Released:
    "inline-flex items-center px-2 py-0.5 rounded-md border border-violet-500/30 text-xs font-medium bg-violet-500/10 text-violet-400",
  "In Progress":
    "inline-flex items-center px-2 py-0.5 rounded-md border border-blue-500/30 text-xs font-medium bg-blue-500/10 text-blue-400",
  Confirmed:
    "inline-flex items-center px-2 py-0.5 rounded-md border border-emerald-500/30 text-xs font-medium bg-emerald-500/10 text-emerald-400",
  Cancelled:
    "inline-flex items-center px-2 py-0.5 rounded-md border border-border/60 text-xs font-medium bg-muted/30 text-muted-foreground"
};

interface PickingListStatusProps {
  status: PickingListStatusValue;
}

export default function PickingListStatus({ status }: PickingListStatusProps) {
  const cls = STATUS_STYLE[status] ?? STATUS_STYLE.Draft;
  return <span className={cls}>{status}</span>;
}
