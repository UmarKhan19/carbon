import { MenuIcon, MenuItem } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsPeopleFill } from "react-icons/bs";
import { LuPencil, LuShapes, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { CustomerType } from "../../types";

type CustomerTypesTableProps = {
  data: CustomerType[];
  count: number;
};

const CustomerTypesTable = memo(({ data, count }: CustomerTypesTableProps) => {
  const { _: t } = useLingui();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const customColumns = useCustomColumns<CustomerType>("customerType");
  const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
      {
        accessorKey: "name",
        header: t(msg({ id: "Customer Type", message: "Customer Type" })),
        cell: ({ row }) => (
          <Enumerable
            value={row.original.name}
            onClick={() => navigate(row.original.id)}
            className="cursor-pointer"
          />
        ),
        meta: {
          icon: <LuShapes />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [navigate, customColumns, t]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.customers}?filter=type:eq:${row.name}`);
            }}
          >
            <MenuIcon icon={<BsPeopleFill />} />
            {t(msg({ id: "View Customers", message: "View Customers" }))}
          </MenuItem>
          <MenuItem
            disabled={row.protected || !permissions.can("update", "sales")}
            onClick={() => {
              navigate(`${path.to.customerType(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            {t(
              msg({ id: "Edit Customer Type", message: "Edit Customer Type" })
            )}
          </MenuItem>
          <MenuItem
            destructive
            disabled={row.protected || !permissions.can("delete", "sales")}
            onClick={() => {
              navigate(
                `${path.to.deleteCustomerType(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            {t(
              msg({
                id: "Delete Customer Type",
                message: "Delete Customer Type"
              })
            )}
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions, t]
  );

  return (
    <Table<(typeof data)[number]>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "sales") && (
          <New
            label={t(msg({ id: "Customer Types", message: "Customer Types" }))}
            to={`${path.to.newCustomerType}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t(msg({ id: "Customer Types", message: "Customer Types" }))}
    />
  );
});

CustomerTypesTable.displayName = "CustomerTypesTable";
export default CustomerTypesTable;
