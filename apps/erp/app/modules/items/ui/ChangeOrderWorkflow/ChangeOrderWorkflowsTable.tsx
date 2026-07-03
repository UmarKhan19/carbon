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
import type { ChangeOrderWorkflow } from "~/modules/items";
import { parseChangeOrderWorkflowContent } from "~/modules/items";
import { path } from "~/utils/path";

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
              Edit Template
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
              Delete Template
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
              <New label={t`Template`} to={path.to.newChangeOrderWorkflow} />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Change Order Templates`}
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
            name={selectedWorkflow.name ?? "change order template"}
            text={t`Are you sure you want to delete this change order template?`}
          />
        )}
      </>
    );
  }
);

ChangeOrderWorkflowsTable.displayName = "ChangeOrderWorkflowsTable";
export default ChangeOrderWorkflowsTable;
