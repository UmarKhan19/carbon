import { MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCircleGauge,
  LuExternalLink,
  LuListChecks
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { useDateFormatter } from "~/hooks";
import type { MyChangeOrderTask } from "~/modules/items";
import { changeOrderStatus } from "~/modules/items";
import { path } from "~/utils/path";
import ChangeOrderStatus from "../ChangeOrder/ChangeOrderStatus";

type MyChangeOrderTasksProps = {
  tasks: MyChangeOrderTask[];
};

const MyChangeOrderTasks = memo(({ tasks }: MyChangeOrderTasksProps) => {
  const navigate = useNavigate();
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();

  const columns = useMemo<ColumnDef<MyChangeOrderTask>[]>(
    () => [
      {
        accessorKey: "changeOrderReadableId",
        header: t`Change Order`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.changeOrder(row.original.changeOrderId)}>
            <div className="flex flex-col gap-0">
              <span className="text-sm font-medium">
                {row.original.changeOrderReadableId}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.original.changeOrderName}
              </span>
            </div>
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "taskTitle",
        header: t`Task`,
        cell: ({ row }) => row.original.taskTitle,
        meta: {
          icon: <LuListChecks />
        }
      },
      {
        accessorKey: "changeOrderStatus",
        header: t`Status`,
        cell: ({ row }) => (
          <ChangeOrderStatus status={row.original.changeOrderStatus} />
        ),
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
        accessorKey: "dueDate",
        header: t`Due Date`,
        cell: ({ row }) =>
          row.original.dueDate ? formatDate(row.original.dueDate) : "—",
        meta: {
          icon: <LuCalendar />
        }
      }
    ],
    [t, formatDate]
  );

  const renderContextMenu = useCallback(
    (row: MyChangeOrderTask) => {
      return (
        <MenuItem
          onClick={() => navigate(path.to.changeOrder(row.changeOrderId))}
        >
          <MenuIcon icon={<LuExternalLink />} />
          {t`View Change Order`}
        </MenuItem>
      );
    },
    [navigate, t]
  );

  return (
    <Table<MyChangeOrderTask>
      data={tasks}
      columns={columns}
      count={tasks.length}
      renderContextMenu={renderContextMenu}
      title={t`My Change Orders`}
      table="changeOrderTask"
      withSavedView
    />
  );
});

MyChangeOrderTasks.displayName = "MyChangeOrderTasks";
export default MyChangeOrderTasks;
