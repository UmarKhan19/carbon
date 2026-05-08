import { Badge, cn, HStack, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import {
  LuCalendar,
  LuMapPin,
  LuShoppingCart,
  LuUser,
  LuUsers,
  LuWarehouse
} from "react-icons/lu";
import { useParams } from "react-router";
import { EmployeeAvatar, Hyperlink } from "~/components";
import { useDateFormatter, useRouteData } from "~/hooks";
import type { PickingListDetail, PickingListLine } from "~/modules/inventory";
import { path } from "~/utils/path";
import PickingListStatus from "./PickingListStatus";

// Right-hand properties panel: progress donut at the top, then a vertical
// list of key metadata (status, job, sales order, customer, location,
// assignee, due, created). Mirrors the mockup in screenshot 2.
export default function PickingListProperties() {
  const { id } = useParams();
  if (!id) throw new Error("id required");

  const { formatDate } = useDateFormatter();

  const routeData = useRouteData<{
    pickingList: PickingListDetail & {
      job?: {
        id?: string;
        jobId?: string;
        salesOrderId?: string | null;
        salesOrder?: {
          id?: string;
          salesOrderId?: string | null;
        } | null;
        customer?: { id?: string; name?: string | null } | null;
      } | null;
      location?: { name?: string | null } | null;
      assigneeUser?: {
        id?: string;
        fullName?: string | null;
        avatarUrl?: string | null;
      } | null;
    };
    pickingListLines: PickingListLine[];
  }>(path.to.pickingList(id));

  const pl = routeData?.pickingList;
  const lines = routeData?.pickingListLines ?? [];

  const totals = lines.reduce(
    (acc, l) => {
      const required = Number(l.adjustedQuantity ?? l.estimatedQuantity ?? 0);
      const picked = Number(l.pickedQuantity ?? 0);
      acc.required += required;
      acc.picked += Math.min(picked, required || picked);
      return acc;
    },
    { required: 0, picked: 0 }
  );
  const pct =
    totals.required > 0 ? Math.min(totals.picked / totals.required, 1) : 0;
  const pctLabel = Math.round(pct * 100);

  if (!pl) return null;

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-card border-l border-border px-4 py-3 text-sm">
      <div className="text-xxs uppercase tracking-wide text-muted-foreground/70 font-medium">
        <Trans>Properties</Trans>
      </div>

      <h2 className="mt-1 text-base font-semibold">{pl.pickingListId}</h2>
      {pl.job?.item?.name && (
        <span className="text-xs text-muted-foreground">
          {pl.job.item.name}
        </span>
      )}

      {/* Donut */}
      <div className="my-5 flex items-center justify-center">
        <ProgressDonut pct={pct} label={`${pctLabel}%`} />
      </div>

      <VStack spacing={3}>
        <PropertyRow label={<Trans>Status</Trans>}>
          <PickingListStatus status={pl.status as any} />
        </PropertyRow>

        {pl.job?.jobId && (
          <PropertyRow label={<Trans>Job</Trans>} icon={<LuWarehouse />}>
            <Hyperlink to={path.to.job(pl.jobId!)}>
              <Badge variant="outline">{pl.job.jobId}</Badge>
            </Hyperlink>
          </PropertyRow>
        )}

        {(pl.job?.salesOrder?.salesOrderId ?? pl.job?.salesOrderId) && (
          <PropertyRow
            label={<Trans>Sales Order</Trans>}
            icon={<LuShoppingCart />}
          >
            {pl.job?.salesOrderId ? (
              <Hyperlink to={path.to.salesOrder(pl.job.salesOrderId)}>
                <Badge variant="outline">
                  {pl.job.salesOrder?.salesOrderId ?? pl.job.salesOrderId}
                </Badge>
              </Hyperlink>
            ) : (
              <Badge variant="outline">
                {pl.job?.salesOrder?.salesOrderId ?? ""}
              </Badge>
            )}
          </PropertyRow>
        )}

        {pl.job?.customer?.name && (
          <PropertyRow label={<Trans>Customer</Trans>} icon={<LuUsers />}>
            <Badge variant="outline" className="rounded-full">
              {pl.job.customer.name}
            </Badge>
          </PropertyRow>
        )}

        {pl.location?.name && (
          <PropertyRow label={<Trans>Warehouse</Trans>} icon={<LuMapPin />}>
            <span className="text-xs">{pl.location.name}</span>
          </PropertyRow>
        )}

        <PropertyRow label={<Trans>Assignee</Trans>} icon={<LuUser />}>
          {pl.assigneeUser?.fullName ? (
            <EmployeeAvatar
              name={pl.assigneeUser.fullName}
              avatarUrl={pl.assigneeUser.avatarUrl}
              size="sm"
            />
          ) : (
            <span className="text-xs text-muted-foreground">
              <Trans>Unassigned</Trans>
            </span>
          )}
        </PropertyRow>

        <PropertyRow label={<Trans>Due</Trans>} icon={<LuCalendar />}>
          {pl.dueDate ? (
            <span className="text-xs">{formatDate(pl.dueDate)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </PropertyRow>

        <PropertyRow label={<Trans>Created</Trans>} icon={<LuCalendar />}>
          {pl.createdAt ? (
            <span className="text-xs">{formatDate(pl.createdAt)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </PropertyRow>
      </VStack>
    </div>
  );
}

function PropertyRow({
  label,
  icon,
  children
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <HStack className="w-full justify-between" spacing={2}>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="flex items-center">{children}</span>
    </HStack>
  );
}

// CSS-only conic-gradient donut. Avoids pulling in a chart lib.
function ProgressDonut({ pct, label }: { pct: number; label: string }) {
  const deg = Math.round(pct * 360);
  return (
    <div
      className="relative h-32 w-32 rounded-full"
      style={{
        background: `conic-gradient(rgb(16 185 129) 0deg, rgb(16 185 129) ${deg}deg, hsl(var(--muted)) ${deg}deg)`
      }}
    >
      <div
        className={cn(
          "absolute inset-2 rounded-full bg-card flex items-center justify-center"
        )}
      >
        <span className="text-2xl font-semibold tabular-nums">{label}</span>
      </div>
    </div>
  );
}
