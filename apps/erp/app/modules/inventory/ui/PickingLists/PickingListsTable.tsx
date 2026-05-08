import { Badge, Button, Combobox, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCirclePlus,
  LuMapPin,
  LuPackage,
  LuShoppingCart,
  LuTriangleAlert,
  LuUser,
  LuUsers
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, ItemThumbnail, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useDateFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { pickingListStatusType } from "../../inventory.models";
import type { PickingList } from "../../types";
import PickingListStatus from "./PickingListStatus";

type PickingListsTableProps = {
  data: PickingList[];
  count: number;
  locations: { id: string; name: string }[];
  locationId: string | null;
};

const PickingListsTable = memo(
  ({
    data,
    count,
    locations: serverLocations,
    locationId
  }: PickingListsTableProps) => {
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const clientLocations = useLocations();
    const locations = useMemo(() => {
      if (serverLocations?.length) {
        return serverLocations.map((l) => ({ value: l.id, label: l.name }));
      }
      return clientLocations;
    }, [serverLocations, clientLocations]);

    const columns = useMemo<ColumnDef<PickingList>[]>(
      () => [
        {
          accessorKey: "pickingListId",
          header: t`PL ID`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.pickingList(row.original.id!)}>
              {row.original.pickingListId}
            </Hyperlink>
          ),
          meta: { icon: <LuBookMarked /> }
        },
        {
          id: "job",
          header: t`Job`,
          cell: ({ row }) => {
            const job = (row.original as any).job;
            return job?.jobId ? (
              <Hyperlink to={path.to.job(row.original.jobId!)}>
                {job.jobId}
              </Hyperlink>
            ) : null;
          },
          meta: { icon: <LuBookMarked /> }
        },
        {
          id: "item",
          header: t`Item`,
          cell: ({ row }) => {
            const item = (row.original as any).job?.item;
            if (!item) return null;
            return (
              <div className="flex items-center gap-2">
                <ItemThumbnail
                  size="sm"
                  thumbnailPath={item.thumbnailPath}
                  type={(item.type as "Part") ?? "Part"}
                />
                <div className="flex flex-col leading-tight">
                  <span className="text-sm">{item.readableId}</span>
                  {item.name && (
                    <span className="text-xs text-muted-foreground">
                      {item.name}
                    </span>
                  )}
                </div>
              </div>
            );
          },
          meta: { icon: <LuPackage /> }
        },
        {
          id: "customer",
          header: t`Customer`,
          cell: ({ row }) => {
            const customer = (row.original as any).job?.customer;
            return customer?.name ? (
              <Badge variant="outline" className="rounded-full">
                <LuUsers className="h-3 w-3 mr-1" />
                {customer.name}
              </Badge>
            ) : null;
          },
          meta: { icon: <LuUsers /> }
        },
        {
          id: "salesOrder",
          header: t`Sales Order`,
          cell: ({ row }) => {
            const job = (row.original as any).job;
            const readable =
              job?.salesOrder?.salesOrderId ?? job?.salesOrderId ?? null;
            if (!readable) return null;
            return job?.salesOrderId ? (
              <Hyperlink to={path.to.salesOrder(job.salesOrderId)}>
                {readable}
              </Hyperlink>
            ) : (
              <span>{readable}</span>
            );
          },
          meta: { icon: <LuShoppingCart /> }
        },
        {
          id: "progress",
          header: t`Progress`,
          cell: ({ row }) => {
            const lines = ((row.original as any).pickingListLine ??
              []) as Array<{
              estimatedQuantity: number | null;
              adjustedQuantity: number | null;
              pickedQuantity: number | null;
            }>;
            const totals = lines.reduce(
              (acc, l) => {
                const est = Number(
                  l.adjustedQuantity ?? l.estimatedQuantity ?? 0
                );
                const picked = Number(l.pickedQuantity ?? 0);
                acc.required += est;
                acc.picked += Math.min(picked, est || picked);
                return acc;
              },
              { required: 0, picked: 0 }
            );
            const required = totals.required;
            const picked = totals.picked;
            const pct = required > 0 ? Math.min(picked / required, 1) : 0;
            const color =
              row.original.status === "Confirmed"
                ? "bg-emerald-500"
                : pct >= 1
                  ? "bg-emerald-500"
                  : "bg-blue-500";
            return (
              <div className="flex items-center gap-2 min-w-[140px]">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full ${color}`}
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {picked}/{required || 0}
                </span>
              </div>
            );
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => {
            const status = row.original.status as any;
            const due = row.original.dueDate
              ? new Date(row.original.dueDate)
              : null;
            const overdue =
              due != null &&
              due < new Date() &&
              !["Confirmed", "Cancelled"].includes(status);
            return (
              <div className="flex items-center gap-2">
                <PickingListStatus status={status} />
                {overdue && (
                  <Badge
                    variant="outline"
                    className="text-red-500 border-red-300"
                  >
                    <LuTriangleAlert className="h-3 w-3 mr-1" />
                    <Trans>Overdue</Trans>
                  </Badge>
                )}
              </div>
            );
          },
          meta: {
            filter: {
              type: "static",
              options: pickingListStatusType.map((s) => ({
                value: s,
                label: <PickingListStatus status={s} />
              }))
            },
            pluralHeader: t`Statuses`
          }
        },
        {
          accessorKey: "assignee",
          header: t`Assignee`,
          cell: ({ row }) => {
            const user = (row.original as any).assigneeUser;
            return user ? (
              <EmployeeAvatar
                name={user.fullName}
                avatarUrl={user.avatarUrl}
                size="sm"
              />
            ) : null;
          },
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) => (
            <Enumerable
              value={
                locations.find((l) => l.value === row.original.locationId)
                  ?.label ?? null
              }
            />
          ),
          meta: { icon: <LuMapPin /> }
        },
        {
          accessorKey: "dueDate",
          header: t`Due`,
          cell: ({ row }) =>
            row.original.dueDate ? formatDate(row.original.dueDate) : null,
          meta: { icon: <LuCalendar /> }
        }
      ],
      [t, formatDate, locations]
    );

    const rowActions = useCallback(
      (row: PickingList): React.ReactNode[] => [
        <MenuItem
          key="open"
          onClick={() => navigate(path.to.pickingList(row.id!))}
        >
          <MenuIcon icon={<LuBookMarked />} />
          <Trans>Open</Trans>
        </MenuItem>
      ],
      [navigate]
    );

    const primaryAction = useMemo(
      () => (
        <div className="flex items-center gap-2">
          <Combobox
            asButton
            size="sm"
            value={locationId ?? ""}
            options={locations}
            onChange={(selected) => {
              window.location.href = `${path.to.pickingLists}?location=${selected}`;
            }}
          />
          {permissions.can("create", "inventory") && (
            <Button
              leftIcon={<LuCirclePlus />}
              onClick={() => navigate(path.to.newPickingList)}
            >
              <Trans>New Picking List</Trans>
            </Button>
          )}
        </div>
      ),
      [locationId, locations, permissions, navigate]
    );

    return (
      <Table<PickingList>
        data={data}
        columns={columns}
        count={count}
        actions={rowActions}
        primaryAction={primaryAction}
        withSearch
        withColumnVisibility
        withPagination
      />
    );
  }
);

PickingListsTable.displayName = "PickingListsTable";

export default PickingListsTable;
