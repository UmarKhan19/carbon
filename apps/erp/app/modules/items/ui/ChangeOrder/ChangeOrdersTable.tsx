import { OnshapeLogo } from "@carbon/ee";
import { Button, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuBookMarked,
  LuCalendar,
  LuChartNoAxesColumnIncreasing,
  LuCircleGauge,
  LuPencil,
  LuShapes,
  LuShieldCheck,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { ChangeOrder } from "~/modules/items";
import {
  changeOrderApprovalType,
  changeOrderStatus,
  changeOrderType
} from "~/modules/items";
import { nonConformancePriority } from "~/modules/quality";
import { usePeople } from "~/stores/people";
import { path } from "~/utils/path";
import ChangeOrderStatus from "./ChangeOrderStatus";
import SyncReleasedFromOnshapeModal from "./SyncReleasedFromOnshapeModal";

type ChangeOrdersTableProps = {
  data: ChangeOrder[];
  count: number;
};

const ChangeOrdersTable = memo(({ data, count }: ChangeOrdersTableProps) => {
  const navigate = useNavigate();
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const permissions = usePermissions();
  const deleteDisclosure = useDisclosure();
  const onshapeDisclosure = useDisclosure();
  const [selectedChangeOrder, setSelectedChangeOrder] =
    useState<ChangeOrder | null>(null);

  const customColumns = useCustomColumns<ChangeOrder>("changeOrder");
  const [people] = usePeople();

  const columns = useMemo<ColumnDef<ChangeOrder>[]>(() => {
    const defaultColumns: ColumnDef<ChangeOrder>[] = [
      {
        accessorKey: "changeOrderId",
        header: t`Name`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.changeOrder(row.original.id!)}>
            <div className="flex flex-col gap-0">
              <span className="text-sm font-medium">
                {row.original.changeOrderId}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.original.name}
              </span>
            </div>
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <ChangeOrderStatus status={row.original.status} />,
        meta: {
          icon: <LuCircleGauge />,
          filter: {
            type: "static",
            options: changeOrderStatus.map((status) => ({
              label: status,
              value: status
            }))
          }
        }
      },
      {
        accessorKey: "type",
        header: t`Type`,
        cell: ({ row }) => <Enumerable value={row.original.type} />,
        meta: {
          icon: <LuShapes />,
          filter: {
            type: "static",
            options: changeOrderType.map((type) => ({
              label: type,
              value: type
            }))
          }
        }
      },
      {
        accessorKey: "priority",
        header: t`Priority`,
        cell: ({ row }) => row.original.priority,
        meta: {
          icon: <LuChartNoAxesColumnIncreasing />,
          filter: {
            type: "static",
            options: nonConformancePriority.map((priority) => ({
              label: priority,
              value: priority
            }))
          }
        }
      },
      {
        accessorKey: "approvalType",
        header: t`Approval`,
        cell: ({ row }) => <Enumerable value={row.original.approvalType} />,
        meta: {
          icon: <LuShieldCheck />,
          filter: {
            type: "static",
            options: changeOrderApprovalType.map((approvalType) => ({
              label: approvalType,
              value: approvalType
            }))
          }
        }
      },
      {
        accessorKey: "assignee",
        header: t`Assignee`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
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
        accessorKey: "openDate",
        header: t`Open Date`,
        cell: ({ row }) => formatDate(row.original.openDate),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "dueDate",
        header: t`Due Date`,
        cell: ({ row }) => formatDate(row.original.dueDate),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "effectiveDate",
        header: t`Effective Date`,
        cell: ({ row }) => formatDate(row.original.effectiveDate),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "createdBy",
        header: t`Created By`,
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
        header: t`Created At`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, people, t, formatDate]);

  const renderContextMenu = useCallback(
    (row: ChangeOrder) => {
      return (
        <>
          <MenuItem
            disabled={!permissions.can("update", "parts")}
            onClick={() => {
              navigate(`${path.to.changeOrder(row.id!)}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Change Order
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "parts")}
            onClick={() => {
              flushSync(() => {
                setSelectedChangeOrder(row);
              });
              deleteDisclosure.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Change Order
          </MenuItem>
        </>
      );
    },
    [navigate, permissions, deleteDisclosure]
  );

  return (
    <>
      <Table<ChangeOrder>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          <>
            {permissions.can("update", "parts") && (
              <Button
                variant="secondary"
                leftIcon={<OnshapeLogo className="h-4 w-auto" />}
                onClick={onshapeDisclosure.onOpen}
              >
                {t`Sync from Onshape`}
              </Button>
            )}
            {permissions.can("create", "parts") && (
              <New label={t`Change Order`} to={path.to.newChangeOrder} />
            )}
          </>
        }
        renderContextMenu={renderContextMenu}
        title={t`Change Orders`}
        table="changeOrder"
        withSavedView
      />
      {onshapeDisclosure.isOpen && (
        <SyncReleasedFromOnshapeModal onClose={onshapeDisclosure.onClose} />
      )}
      {deleteDisclosure.isOpen && selectedChangeOrder && (
        <ConfirmDelete
          action={path.to.deleteChangeOrder(selectedChangeOrder.id!)}
          isOpen
          onCancel={() => {
            setSelectedChangeOrder(null);
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            setSelectedChangeOrder(null);
            deleteDisclosure.onClose();
          }}
          name={selectedChangeOrder.name ?? "change order"}
          text={t`Are you sure you want to delete this change order?`}
        />
      )}
    </>
  );
});

ChangeOrdersTable.displayName = "ChangeOrdersTable";
export default ChangeOrdersTable;
