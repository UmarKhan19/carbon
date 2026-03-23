import { Avatar, Badge, HStack, MenuIcon, MenuItem } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuClock,
  LuMapPin,
  LuPencil,
  LuRadar,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

type TimeCardEntry = {
  id: string | null;
  employeeId: string | null;
  avatarUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  clockIn: string | null;
  clockOut: string | null;
  shiftName: string | null;
  locationName: string | null;
  status: string | null;
  note: string | null;
};

type TimecardsTableProps = {
  data: TimeCardEntry[];
  count: number;
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(clockInStr: string, clockOutStr: string) {
  const ms = new Date(clockOutStr).getTime() - new Date(clockInStr).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

const TimecardsTable = memo(({ data, count }: TimecardsTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();
  const locations = useLocations();

  const columns = useMemo<ColumnDef<TimeCardEntry>[]>(
    () => [
      {
        header: "Employee",
        cell: ({ row }) => (
          <Hyperlink to={path.to.personTimecard(row.original.employeeId!)}>
            <HStack className="items-center gap-2">
              <Avatar
                className="size-6"
                src={row.original.avatarUrl ?? undefined}
                name={`${row.original.firstName ?? ""} ${row.original.lastName ?? ""}`}
              />
              <span className="text-sm">
                {row.original.firstName} {row.original.lastName}
              </span>
            </HStack>
          </Hyperlink>
        ),
        meta: {
          icon: <LuUser />
        }
      },
      {
        accessorKey: "clockIn",
        header: "Date",
        cell: ({ row }) =>
          row.original.clockIn
            ? formatDate(row.original.clockIn, { dateStyle: "medium" })
            : "—",
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "clockInTime",
        header: "Clock In",
        cell: ({ row }) =>
          row.original.clockIn ? formatTime(row.original.clockIn) : "—",
        meta: {
          icon: <LuClock />
        }
      },
      {
        id: "clockOutTime",
        header: "Clock Out",
        cell: ({ row }) =>
          row.original.clockOut ? formatTime(row.original.clockOut) : "—",
        meta: {
          icon: <LuClock />
        }
      },
      {
        id: "duration",
        header: "Duration",
        cell: ({ row }) => {
          if (!row.original.clockIn || !row.original.clockOut) return "—";
          return formatDuration(row.original.clockIn, row.original.clockOut);
        },
        meta: {
          icon: <LuClock />
        }
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === "Active" ? "green" : "secondary"}
          >
            {row.original.status}
          </Badge>
        ),
        meta: {
          icon: <LuRadar />,
          filter: {
            type: "static" as const,
            options: [
              {
                value: "Active",
                label: <Badge variant="green">Active</Badge>
              },
              {
                value: "Complete",
                label: <Badge variant="secondary">Complete</Badge>
              }
            ],
            isArray: false
          }
        }
      },
      {
        accessorKey: "locationName",
        header: "Location",
        cell: ({ row }) => (
          <Enumerable value={row.original.locationName ?? null} />
        ),
        meta: {
          icon: <LuMapPin />,
          filter: {
            type: "static" as const,
            options: locations.map((location) => ({
              value: location.label,
              label: <Enumerable value={location.label} />
            })),
            isArray: false
          }
        }
      }
    ],
    [locations]
  );

  const renderContextMenu = useCallback(
    (row: TimeCardEntry) => {
      if (!row.id) return null;
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "people")}
            onClick={() =>
              navigate(`${path.to.timecard(row.id!)}?${params.toString()}`)
            }
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Timecard
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "people")}
            onClick={() =>
              navigate(
                `${path.to.deleteTimecard(row.id!)}?${params.toString()}`
              )
            }
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Timecard
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<TimeCardEntry>
      data={data}
      count={count}
      columns={columns}
      primaryAction={
        permissions.can("create", "people") && (
          <New label="Timecard" to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
      withSearch
      withPagination
      withSavedView
      title="Timecards"
      table="timeCardEntry"
    />
  );
});

TimecardsTable.displayName = "TimecardsTable";
export default TimecardsTable;
