import { MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { ChangeOrderType } from "../../changeOrder.types";

type ChangeOrderTypesTableProps = {
  data: ChangeOrderType[];
  count: number;
};

const ChangeOrderTypesTable = memo(
  ({ data, count }: ChangeOrderTypesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();

    const rows = useMemo(() => data, [data]);

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Enumerable
              value={row.original.name}
              onClick={() =>
                navigate(
                  `${path.to.changeOrderType(
                    row.original.id
                  )}?${params.toString()}`
                )
              }
              className="cursor-pointer"
            />
          )
        }
      ];
    }, [navigate, params, t]);

    const renderContextMenu = useCallback(
      (row: (typeof rows)[number]) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "production")}
              onClick={() => {
                navigate(
                  `${path.to.changeOrderType(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Type
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "production")}
              onClick={() => {
                navigate(
                  `${path.to.deleteChangeOrderType(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Type
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<(typeof rows)[number]>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "production") && (
            <New
              label={t`Type`}
              to={`${path.to.newChangeOrderType}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Change Order Types`}
        table="changeOrderType"
        withSavedView
      />
    );
  }
);

ChangeOrderTypesTable.displayName = "ChangeOrderTypesTable";
export default ChangeOrderTypesTable;
