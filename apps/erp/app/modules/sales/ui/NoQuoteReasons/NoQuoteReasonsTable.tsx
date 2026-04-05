import { MenuIcon, MenuItem } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuBookMarked, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { NoQuoteReason } from "../../types";

type NoQuoteReasonsTableProps = {
  data: NoQuoteReason[];
  count: number;
};

const NoQuoteReasonsTable = memo(
  ({ data, count }: NoQuoteReasonsTableProps) => {
    const { _: t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const customColumns = useCustomColumns<NoQuoteReason>("noQuoteReason");
    const columns = useMemo<ColumnDef<NoQuoteReason>[]>(() => {
      const defaultColumns: ColumnDef<NoQuoteReason>[] = [
        {
          accessorKey: "name",
          header: t(msg({ id: "Reason", message: "Reason" })),
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        }
      ];
      return [...defaultColumns, ...customColumns];
    }, [customColumns, t]);

    const renderContextMenu = useCallback(
      (row: NoQuoteReason) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.noQuoteReason(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {t(msg({ id: "Edit Reason", message: "Edit Reason" }))}
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.deleteNoQuoteReason(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              {t(msg({ id: "Delete Reason", message: "Delete Reason" }))}
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions, t]
    );

    return (
      <Table<NoQuoteReason>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "sales") && (
            <New
              label={t(msg({ id: "Reason", message: "Reason" }))}
              to={`${path.to.newNoQuoteReason}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t(msg({ id: "Reasons", message: "Reasons" }))}
      />
    );
  }
);

NoQuoteReasonsTable.displayName = "NoQuoteReasonsTable";
export default NoQuoteReasonsTable;
