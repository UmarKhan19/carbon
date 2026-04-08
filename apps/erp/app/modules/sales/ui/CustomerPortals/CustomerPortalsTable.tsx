import type { Database } from "@carbon/database";
import { Copy, MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuExternalLink,
  LuPencil,
  LuSquareUser,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { CustomerAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";

type CustomerPortal = Database["public"]["Tables"]["externalLink"]["Row"];

type CustomerPortalsTableProps = {
  appUrl: string;
  data: CustomerPortal[];
  count: number;
};

const CustomerPortalsTable = memo(
  ({ appUrl, data, count }: CustomerPortalsTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const columns = useMemo<ColumnDef<CustomerPortal>[]>(() => {
      const defaultColumns: ColumnDef<CustomerPortal>[] = [
        {
          accessorKey: "customer.name",
          header: t({ id: "Customer", message: "Customer" }),
          cell: ({ row }) => (
            <Hyperlink
              to={path.to.customer(
                row.original.customerId ?? row.original.documentId ?? ""
              )}
            >
              <CustomerAvatar
                customerId={
                  row.original.customerId ?? row.original.documentId ?? ""
                }
              />
            </Hyperlink>
          ),
          meta: {
            icon: <LuSquareUser />
          }
        },
        {
          accessorKey: "portalLink",
          header: t({ id: "Portal Link", message: "Portal Link" }),
          cell: ({ row }) => {
            const portalUrl = `${appUrl}/share/customer/${row.original.id}`;
            return (
              <div className="flex items-center gap-2">
                <a
                  href={portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono underline"
                >
                  {portalUrl}
                </a>
                <Copy text={portalUrl} />
              </div>
            );
          },
          meta: {
            icon: <LuExternalLink />
          }
        }
      ];
      return defaultColumns;
    }, [appUrl, t]);

    const renderContextMenu = useCallback(
      (row: CustomerPortal) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.customerPortal(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {t({ id: "Edit Portal", message: "Edit Portal" })}
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.deleteCustomerPortal(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              {t({ id: "Delete Portal", message: "Delete Portal" })}
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions, t]
    );

    return (
      <Table<CustomerPortal>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "sales") && (
            <New
              label={t({ id: "Customer Portal", message: "Customer Portal" })}
              to={`${path.to.newCustomerPortal}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t({ id: "Customer Portals", message: "Customer Portals" })}
      />
    );
  }
);

CustomerPortalsTable.displayName = "CustomerPortalsTable";
export default CustomerPortalsTable;
