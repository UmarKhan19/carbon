import { Button, HStack, MenuIcon, MenuItem } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BiAddToQueue } from "react-icons/bi";
import { BsListUl } from "react-icons/bs";
import { LuDatabase, LuLayoutGrid, LuList, LuTags } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import type { CustomFieldsTableType } from "~/modules/settings";
import { modulesType } from "~/modules/settings";
import { tablesWithTags } from "~/modules/shared";
import { path } from "~/utils/path";

type CustomFieldsTableProps = {
  data: CustomFieldsTableType[];
  count: number;
};

const CustomFieldsTable = memo(({ data, count }: CustomFieldsTableProps) => {
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<CustomFieldsTableType>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Table",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Hyperlink to={row.original.table!}>{row.original.name}</Hyperlink>
            {tablesWithTags.includes(row.original.table!) && (
              <LuTags className="text-emerald-500" />
            )}
          </div>
        ),
        meta: {
          icon: <LuDatabase />
        }
      },
      {
        accessorKey: "module",
        header: "Module",
        cell: ({ row }) => <Enumerable value={row.original.module} />,
        meta: {
          icon: <LuLayoutGrid />,
          filter: {
            type: "static",
            options: modulesType.map((m) => ({
              label: <Enumerable value={m} />,
              value: m
            }))
          }
        }
      },
      {
        header: "Fields",
        cell: ({ row }) => (
          <HStack className="text-xs text-muted-foreground">
            <LuList />
            <span>
              {Array.isArray(row.original.fields)
                ? (row.original.fields?.length ?? 0)
                : 0}{" "}
              Fields
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigate(
                  `${path.to.customFieldList(
                    row.original.table!
                  )}?${params?.toString()}`
                );
              }}
            >
              Edit
            </Button>
          </HStack>
        )
      }
    ];
  }, [navigate, params]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(
                `${path.to.newCustomField(row.table!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<BiAddToQueue />} />
            New Field
          </MenuItem>
          <MenuItem
            onClick={() => {
              navigate(
                `${path.to.customFieldList(row.table!)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<BsListUl />} />
            View Custom Fields
          </MenuItem>
        </>
      );
    },

    [navigate, params, permissions]
  );

  return (
    <>
      <Table<CustomFieldsTableType>
        data={data}
        columns={columns}
        count={count ?? 0}
        title="Custom Fields"
        renderContextMenu={renderContextMenu}
      />
    </>
  );
});

CustomFieldsTable.displayName = "CustomFieldsTable";
export default CustomFieldsTable;
