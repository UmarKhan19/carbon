import {
  Badge,
  Button,
  Checkbox,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  HStack,
  MenuIcon,
  MenuItem,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuAlignJustify,
  LuBookMarked,
  LuCalendar,
  LuCheck,
  LuGitPullRequestArrow,
  LuGroup,
  LuLoaderCircle,
  LuPencil,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetArrow } from "react-icons/tb";
import { Link, useFetcher, useNavigate } from "react-router";
import {
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  MethodIcon,
  New,
  Table,
  TrackingTypeIcon
} from "~/components";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import {
  itemReplenishmentSystems,
  itemTrackingTypes
} from "../../items.models";
import type { Tool } from "../../types";

type ToolsTableProps = {
  data: Tool[];
  tags: { name: string }[];
  count: number;
};

const ToolsTable = memo(({ data, tags, count }: ToolsTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();

  const deleteItemModal = useDisclosure();
  const [selectedItem, setSelectedItem] = useState<Tool | null>(null);

  const [people] = usePeople();
  const itemPostingGroups = useItemPostingGroups();
  const customColumns = useCustomColumns<Tool>("tool");

  const columns = useMemo<ColumnDef<Tool>[]>(() => {
    const defaultColumns: ColumnDef<Tool>[] = [
      {
        accessorKey: "id",
        header: "Tool ID",
        cell: ({ row }) => (
          <HStack className="py-1 min-w-[200px] truncate">
            <ItemThumbnail
              size="md"
              thumbnailPath={row.original.thumbnailPath}
              type="Tool"
            />
            <Hyperlink to={path.to.toolDetails(row.original.id!)}>
              <VStack spacing={0}>
                {row.original.readableIdWithRevision}
                <div className="w-full truncate text-muted-foreground text-xs">
                  {row.original.name}
                </div>
              </VStack>
            </Hyperlink>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: (item) => (
          <div className="max-w-[320px] truncate">
            {item.getValue<string>()}
          </div>
        ),
        meta: {
          icon: <LuAlignJustify />
        }
      },
      {
        accessorKey: "itemPostingGroupId",
        header: "Item Group",
        cell: (item) => {
          const itemPostingGroupId = item.getValue<string>();
          const itemPostingGroup = itemPostingGroups.find(
            (group) => group.value === itemPostingGroupId
          );
          const label = itemPostingGroup?.label;
          return label ? <Badge variant="secondary">{label}</Badge> : null;
        },
        meta: {
          filter: {
            type: "static",
            options: itemPostingGroups.map((group) => ({
              value: group.value,
              label: <Badge variant="secondary">{group.label}</Badge>
            }))
          },
          icon: <LuGroup />
        }
      },
      {
        accessorKey: "itemTrackingType",
        header: "Tracking",
        cell: (item) => (
          <Badge variant="secondary">
            <TrackingTypeIcon type={item.getValue<string>()} className="mr-2" />
            <span>{item.getValue<string>()}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: itemTrackingTypes.map((type) => ({
              value: type,
              label: (
                <Badge variant="secondary">
                  <TrackingTypeIcon type={type} className="mr-2" />
                  <span>{type}</span>
                </Badge>
              )
            }))
          },
          icon: <TbTargetArrow />
        }
      },

      {
        accessorKey: "defaultMethodType",
        header: "Default Method",
        cell: (item) => (
          <Badge variant="secondary">
            <MethodIcon type={item.getValue<string>()} className="mr-2" />
            <span>{item.getValue<string>()}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: methodType.map((value) => ({
              value,
              label: (
                <Badge variant="secondary">
                  <MethodIcon type={value} className="mr-2" />
                  <span>{value}</span>
                </Badge>
              )
            }))
          },
          icon: <RxCodesandboxLogo />
        }
      },
      {
        accessorKey: "replenishmentSystem",
        header: "Replenishment",
        cell: (item) => (
          <Badge variant="secondary">
            <ReplenishmentSystemIcon
              type={item.getValue<string>()}
              className="mr-2"
            />
            <span>{item.getValue<string>()}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: itemReplenishmentSystems.map((type) => ({
              value: type,
              label: (
                <Badge variant="secondary">
                  <ReplenishmentSystemIcon type={type} className="mr-2" />
                  <span>{type}</span>
                </Badge>
              )
            }))
          },
          icon: <LuLoaderCircle />
        }
      },
      {
        accessorKey: "tags",
        header: "Tags",
        cell: ({ row }) => (
          <HStack spacing={0} className="gap-1">
            {row.original.tags?.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </HStack>
        ),
        meta: {
          filter: {
            type: "static",
            options: tags?.map((tag) => ({
              value: tag.name,
              label: <Badge variant="secondary">{tag.name}</Badge>
            })),
            isArray: true
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "active",
        header: "Active",
        cell: (item) => <Checkbox isChecked={item.getValue<boolean>()} />,
        meta: {
          filter: {
            type: "static",
            options: [
              { value: "true", label: "Active" },
              { value: "false", label: "Inactive" }
            ]
          },
          pluralHeader: "Active Statuses",
          icon: <LuCheck />
        }
      },
      // {
      //   id: "assignee",
      //   header: "Assignee",
      //   cell: ({ row }) => (
      //     <EmployeeAvatar employeeId={row.original.assignee} />
      //   ),
      //   meta: {
      //     filter: {
      //       type: "static",
      //       options: people.map((employee) => ({
      //         value: employee.id,
      //         label: employee.name,
      //       })),
      //     },
      //   },
      // },
      {
        id: "createdBy",
        header: "Created By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "updatedBy",
        header: "Updated By",
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "updatedAt",
        header: "Updated At",
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, people, tags, itemPostingGroups]);

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onBulkUpdate = useCallback(
    (
      selectedRows: typeof data,
      field:
        | "replenishmentSystem"
        | "defaultMethodType"
        | "itemTrackingType"
        | "itemPostingGroupId",
      value: string
    ) => {
      const formData = new FormData();
      selectedRows.forEach((row) => {
        if (row.id) formData.append("items", row.id);
      });
      formData.append("field", field);
      formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateItems
      });
    },

    []
  );

  const renderActions = useCallback(
    (selectedRows: typeof data) => {
      return (
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel>Update</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Item Group</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {itemPostingGroups.map((group) => (
                    <DropdownMenuItem
                      key={group.value}
                      onClick={() =>
                        onBulkUpdate(
                          selectedRows,
                          "itemPostingGroupId",
                          group.value
                        )
                      }
                    >
                      <span>{group.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Default Method Type
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {methodType.map((type) => (
                    <DropdownMenuItem
                      key={type}
                      onClick={() =>
                        onBulkUpdate(selectedRows, "defaultMethodType", type)
                      }
                    >
                      <DropdownMenuIcon icon={<MethodIcon type={type} />} />
                      <span>{type}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Tracking Type</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {itemTrackingTypes.map((type) => (
                    <DropdownMenuItem
                      key={type}
                      onClick={() =>
                        onBulkUpdate(selectedRows, "itemTrackingType", type)
                      }
                    >
                      <DropdownMenuIcon
                        icon={<TrackingTypeIcon type={type} />}
                      />
                      <span>{type}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      );
    },
    [onBulkUpdate, itemPostingGroups]
  );

  const renderContextMenu = useMemo(() => {
    return (row: Tool) => {
      const revisions =
        (row.revisions as {
          id: string;
          revision: number;
        }[]) ?? [];
      return (
        <>
          <MenuItem onClick={() => navigate(path.to.tool(row.id!))}>
            <MenuIcon icon={<LuPencil />} />
            Edit Tool
          </MenuItem>
          {revisions && revisions.length > 1 && (
            <MenuSub>
              <MenuSubTrigger>
                <MenuIcon icon={<LuGitPullRequestArrow />} />
                Versions
              </MenuSubTrigger>
              <MenuSubContent>
                {revisions.map((revision) => (
                  <MenuItem
                    key={revision.id}
                    onClick={() => navigate(path.to.tool(revision.id))}
                  >
                    <MenuIcon icon={<LuTag />} />
                    Revision {revision.revision}
                  </MenuItem>
                ))}
              </MenuSubContent>
            </MenuSub>
          )}
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "parts")}
            onClick={() => {
              setSelectedItem(row);
              deleteItemModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Tool
          </MenuItem>
        </>
      );
    };
  }, [deleteItemModal, navigate, permissions]);

  return (
    <>
      <Table<Tool>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["id"]
        }}
        defaultColumnVisibility={{
          description: false,
          active: false,
          createdBy: false,
          createdAt: false,
          updatedBy: false,
          updatedAt: false
        }}
        importCSV={[
          {
            table: "tool",
            label: "Tools"
          }
        ]}
        primaryAction={
          permissions.can("create", "parts") && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" leftIcon={<LuGroup />} asChild>
                <Link to={path.to.itemPostingGroups}>Item Groups</Link>
              </Button>
              <New label="Tool" to={path.to.newTool} />
            </div>
          )
        }
        renderActions={renderActions}
        renderContextMenu={renderContextMenu}
        title="Tools"
        table="tool"
        withSavedView
        withSelectableRows
      />
      {selectedItem && selectedItem.id && (
        <ConfirmDelete
          action={path.to.deleteItem(selectedItem.id!)}
          isOpen={deleteItemModal.isOpen}
          name={selectedItem.readableIdWithRevision!}
          text={`Are you sure you want to delete ${selectedItem.readableIdWithRevision!}? This cannot be undone.`}
          onCancel={() => {
            deleteItemModal.onClose();
            setSelectedItem(null);
          }}
          onSubmit={() => {
            deleteItemModal.onClose();
            setSelectedItem(null);
          }}
        />
      )}
    </>
  );
});

ToolsTable.displayName = "ToolTable";

export default ToolsTable;
