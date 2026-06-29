import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuBookMarked,
  LuChartNoAxesColumnIncreasing,
  LuPencil,
  LuShieldCheck,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { parseChangeOrderWorkflowContent } from "../../changeOrder.models";
import type { ChangeOrderWorkflow } from "../../changeOrder.types";

type ChangeOrderWorkflowsTableProps = {
  data: ChangeOrderWorkflow[];
  count: number;
};

const ChangeOrderWorkflowsTable = memo(
  ({ data, count }: ChangeOrderWorkflowsTableProps) => {
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();
    const deleteDisclosure = useDisclosure();
    const [selectedWorkflow, setSelectedWorkflow] =
      useState<ChangeOrderWorkflow | null>(null);

    const columns = useMemo<ColumnDef<ChangeOrderWorkflow>[]>(() => {
      return [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.changeOrderWorkflow(row.original.id)}>
              {row.original.name}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          id: "priority",
          header: t`Default Priority`,
          cell: ({ row }) =>
            parseChangeOrderWorkflowContent(row.original.content).priority ??
            "—",
          meta: {
            icon: <LuChartNoAxesColumnIncreasing />
          }
        },
        {
          id: "approvalType",
          header: t`Approval Type`,
          cell: ({ row }) =>
            parseChangeOrderWorkflowContent(row.original.content)
              .approvalType ?? "—",
          meta: {
            icon: <LuShieldCheck />
          }
        }
      ];
    }, [t]);

    const renderContextMenu = useCallback(
      (row: ChangeOrderWorkflow) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "production")}
              onClick={() => {
                navigate(path.to.changeOrderWorkflow(row.id));
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Workflow
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "production")}
              onClick={() => {
                flushSync(() => {
                  setSelectedWorkflow(row);
                });
                deleteDisclosure.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Workflow
            </MenuItem>
          </>
        );
      },
      [navigate, permissions, deleteDisclosure]
    );

    return (
      <>
        <Table<ChangeOrderWorkflow>
          data={data}
          columns={columns}
          count={count}
          primaryAction={
            permissions.can("create", "production") && (
              <New label={t`Workflow`} to={path.to.newChangeOrderWorkflow} />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Change Order Workflows`}
          table="changeOrderWorkflow"
          withSavedView
        />
        {deleteDisclosure.isOpen && selectedWorkflow && (
          <ConfirmDelete
            action={path.to.deleteChangeOrderWorkflow(selectedWorkflow.id)}
            isOpen
            onCancel={() => {
              setSelectedWorkflow(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedWorkflow(null);
              deleteDisclosure.onClose();
            }}
            name={selectedWorkflow.name ?? "change order workflow"}
            text={t`Are you sure you want to delete this change order workflow?`}
          />
        )}
      </>
    );
  }
);

ChangeOrderWorkflowsTable.displayName = "ChangeOrderWorkflowsTable";
export default ChangeOrderWorkflowsTable;
