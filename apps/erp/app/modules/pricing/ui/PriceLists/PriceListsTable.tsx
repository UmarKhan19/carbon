import { Badge, MenuIcon, MenuItem, Status } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { PriceList, PriceListStatusType } from "../../types";
import PriceListStatus from "../PriceListStatus";

type PriceListsTableProps = {
  data: PriceList[];
  count: number;
  type: "Sales" | "Purchase";
  overlapIds: string[];
};

const PriceListsTable = ({
  data,
  count,
  type,
  overlapIds
}: PriceListsTableProps) => {
  const overlapSet = useMemo(() => new Set(overlapIds), [overlapIds]);

  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();

  const permissionModule = type === "Sales" ? "sales" : "purchasing";
  const listPath =
    type === "Sales" ? path.to.salesPriceLists : path.to.purchasePriceLists;

  const columns = useMemo<ColumnDef<PriceList>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Hyperlink to={path.to.priceListDetails(row.original.id)}>
            {row.original.name}
          </Hyperlink>
        )
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (item) => (
          <PriceListStatus status={item.getValue<PriceListStatusType>()} />
        ),
        meta: {
          filter: {
            type: "static",
            options: (["Draft", "Active", "Expired", "Archived"] as const).map(
              (s) => ({
                value: s,
                label: <PriceListStatus status={s} />
              })
            )
          }
        }
      },
      {
        id: "overlap",
        header: "Overlap",
        cell: ({ row }) =>
          overlapSet.has(row.original.id) ? (
            <Status color="yellow">Overlap</Status>
          ) : null
      },
      {
        accessorKey: "priceType",
        header: "Price Type",
        cell: (item) => item.getValue<string>() ?? "Net"
      },
      {
        id: "scope",
        header: "Scope",
        cell: ({ row }) => {
          const assignments = (row.original as any).priceListAssignment;
          const count = assignments?.[0]?.count ?? 0;
          return count === 0 ? (
            <Badge variant="secondary">Global</Badge>
          ) : (
            <span className="text-muted-foreground">{count} assigned</span>
          );
        }
      },
      {
        accessorKey: "currencyCode",
        header: "Currency",
        cell: (item) => item.getValue<string>() ?? "—"
      },
      {
        accessorKey: "version",
        header: "Version",
        cell: ({ row }) => `v${row.original.version}`
      },
      {
        accessorKey: "validFrom",
        header: "Valid From",
        cell: (item) => {
          const val = item.getValue<string>();
          return val ? formatDate(val) : "—";
        }
      },
      {
        accessorKey: "validTo",
        header: "Valid To",
        cell: (item) => {
          const val = item.getValue<string>();
          return val ? formatDate(val) : "—";
        }
      }
    ],
    [overlapSet]
  );

  const renderContextMenu = useCallback(
    (row: PriceList) => (
      <>
        <MenuItem onClick={() => navigate(path.to.priceListDetails(row.id))}>
          <MenuIcon icon={<LuPencil />} />
          Edit Price List
        </MenuItem>
        <MenuItem
          destructive
          disabled={!permissions.can("delete", permissionModule)}
          onClick={() =>
            navigate(`${listPath}/delete/${row.id}?${params.toString()}`)
          }
        >
          <MenuIcon icon={<LuTrash />} />
          Delete Price List
        </MenuItem>
      </>
    ),
    [navigate, listPath, params, permissions, permissionModule]
  );

  return (
    <Table<PriceList>
      count={count}
      columns={columns}
      data={data}
      defaultColumnVisibility={{
        validFrom: false,
        validTo: false
      }}
      primaryAction={
        permissions.can("create", permissionModule) && (
          <New label="Price List" to={`${listPath}/new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
    />
  );
};

export default PriceListsTable;
