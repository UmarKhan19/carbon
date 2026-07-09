import { Checkbox, MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBuilding2,
  LuCalendarDays,
  LuCheck,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { ResourceCalendar } from "~/modules/resources";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type ResourceCalendarsTableProps = {
  data: ResourceCalendar[];
  count: number;
  locations: ListItem[];
};

const ResourceCalendarsTable = memo(
  ({ data, count, locations }: ResourceCalendarsTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const [params] = useUrlParams();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<ResourceCalendar>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Calendar`,
          cell: ({ row }) => (
            <Hyperlink to={row.original.id!}>
              <Enumerable
                value={row.original.name}
                className="cursor-pointer"
              />
            </Hyperlink>
          ),
          meta: {
            icon: <LuCalendarDays />
          }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) => (
            <Enumerable
              value={
                locations.find((l) => l.id === row.original.locationId)?.name ??
                null
              }
            />
          ),
          meta: {
            icon: <LuBuilding2 />
          }
        },
        {
          accessorKey: "active",
          header: t`Active`,
          cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
          meta: {
            filter: {
              type: "static",
              options: [
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" }
              ]
            },
            pluralHeader: t`Active Statuses`,
            icon: <LuCheck />
          }
        }
      ];
    }, [t, locations]);

    const renderContextMenu = useCallback<
      (row: ResourceCalendar) => JSX.Element
    >(
      (row) => (
        <>
          <MenuItem
            onClick={() => {
              navigate(
                `${path.to.resourceCalendar(row.id!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            <Trans>Edit Calendar</Trans>
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "resources")}
            onClick={() => {
              navigate(
                `${path.to.deleteResourceCalendar(
                  row.id!
                )}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            <Trans>Deactivate Calendar</Trans>
          </MenuItem>
        </>
      ),
      [navigate, params, permissions]
    );

    return (
      <Table<ResourceCalendar>
        data={data}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          permissions.can("create", "resources") && (
            <New label={t`Calendar`} to={`new?${params.toString()}`} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Calendars`}
        table="resourceCalendar"
        withSavedView
      />
    );
  }
);

ResourceCalendarsTable.displayName = "ResourceCalendarsTable";
export default ResourceCalendarsTable;
