import {
  Badge,
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCalendar,
  LuCopy,
  LuLink,
  LuMapPin,
  LuShoppingCart,
  LuUser,
  LuUsers,
  LuWarehouse
} from "react-icons/lu";
import { useParams } from "react-router";
import {
  Assignee,
  EmployeeAvatar,
  Hyperlink,
  useOptimisticAssignment
} from "~/components";
import { useDateFormatter, usePermissions, useRouteData } from "~/hooks";
import type { PickingListDetail, PickingListLine } from "~/modules/inventory";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import PickingListStatus from "./PickingListStatus";

export default function PickingListProperties() {
  const { id } = useParams();
  if (!id) throw new Error("id required");

  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const permissions = usePermissions();

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
        item?: { name?: string | null } | null;
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

  const optimisticAssignment = useOptimisticAssignment({
    id,
    table: "pickingList"
  });
  const assignee =
    optimisticAssignment !== undefined ? optimisticAssignment : pl?.assignee;

  const canUpdate = permissions.can("update", "inventory");

  if (!pl) return null;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={4}>
        <HStack className="w-full justify-between">
          <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
            <Trans>Properties</Trans>
          </h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Link`}
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin + path.to.pickingList(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <Trans>Copy link to Picking List</Trans>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Copy`}
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(pl.pickingListId ?? "")}
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <Trans>Copy Picking List number</Trans>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{pl.pickingListId}</span>
      </VStack>

      <Assignee
        id={id}
        table="pickingList"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!canUpdate}
      />

      <VStack spacing={3}>
        <PropertyRow label={<Trans>Status</Trans>}>
          <PickingListStatus status={pl.status as any} />
        </PropertyRow>

        <PropertyRow label={<Trans>Progress</Trans>}>
          <span className="text-xs tabular-nums">
            {totals.picked}/{totals.required || 0}{" "}
            <span className="text-muted-foreground">({pctLabel}%)</span>
          </span>
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
          {pl.assignee ? (
            <EmployeeAvatar employeeId={pl.assignee} size="sm" />
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
    </VStack>
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
