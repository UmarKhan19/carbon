import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MenuIcon,
  MenuItem
} from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuChevronDown,
  LuPencil,
  LuTag,
  LuThermometer,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import type { ShelfLifeLabelType, StorageType } from "~/modules/inventory";
import { path } from "~/utils/path";

type ShelfLifeTypeRow =
  | (StorageType & { category: "Storage Type" })
  | (ShelfLifeLabelType & { category: "Label Type"; description?: null });

type ShelfLifeTypesTableProps = {
  storageTypes: StorageType[];
  labelTypes: ShelfLifeLabelType[];
};

const ShelfLifeTypesTable = memo(
  ({ storageTypes, labelTypes }: ShelfLifeTypesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const data = useMemo<ShelfLifeTypeRow[]>(
      () => [
        ...storageTypes.map((t) => ({
          ...t,
          category: "Storage Type" as const
        })),
        ...labelTypes.map((t) => ({
          ...t,
          category: "Label Type" as const,
          description: null
        }))
      ],
      [storageTypes, labelTypes]
    );

    const columns = useMemo<ColumnDef<ShelfLifeTypeRow>[]>(
      () => [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => {
            const to =
              row.original.category === "Storage Type"
                ? `${path.to.storageType(row.original.id)}?${params.toString()}`
                : `${path.to.shelfLifeLabelType(row.original.id)}?${params.toString()}`;
            return <Hyperlink to={to}>{row.original.name}</Hyperlink>;
          },
          meta: { icon: <LuBookMarked /> }
        },
        {
          accessorKey: "category",
          header: "Type",
          cell: ({ row }) => (
            <Badge variant="outline" className="gap-1">
              {row.original.category === "Storage Type" ? (
                <LuThermometer className="w-3 h-3" />
              ) : (
                <LuTag className="w-3 h-3" />
              )}
              {row.original.category}
            </Badge>
          )
        },
        {
          accessorKey: "description",
          header: "Description",
          cell: (item) => item.getValue() ?? "—"
        }
      ],
      [params]
    );

    const renderContextMenu = useCallback(
      (row: ShelfLifeTypeRow) => {
        const editTo =
          row.category === "Storage Type"
            ? `${path.to.storageType(row.id)}?${params.toString()}`
            : `${path.to.shelfLifeLabelType(row.id)}?${params.toString()}`;

        const deleteTo =
          row.category === "Storage Type"
            ? `${path.to.deleteStorageType(row.id)}?${params.toString()}`
            : `${path.to.deleteShelfLifeLabelType(row.id)}?${params.toString()}`;

        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "inventory")}
              onClick={() => navigate(editTo)}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit {row.category}
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "inventory")}
              onClick={() => navigate(deleteTo)}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete {row.category}
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    const canCreate = permissions.can("create", "inventory");

    return (
      <Table<ShelfLifeTypeRow>
        data={data}
        columns={columns}
        count={data.length}
        primaryAction={
          canCreate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" rightIcon={<LuChevronDown />}>
                  New
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    navigate(`${path.to.newStorageType}?${params.toString()}`)
                  }
                >
                  <DropdownMenuIcon icon={<LuThermometer />} />
                  Storage Type
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    navigate(
                      `${path.to.newShelfLifeLabelType}?${params.toString()}`
                    )
                  }
                >
                  <DropdownMenuIcon icon={<LuTag />} />
                  Label Type
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
        renderContextMenu={renderContextMenu}
        title="Shelf Life Types"
      />
    );
  }
);

ShelfLifeTypesTable.displayName = "ShelfLifeTypesTable";
export default ShelfLifeTypesTable;
