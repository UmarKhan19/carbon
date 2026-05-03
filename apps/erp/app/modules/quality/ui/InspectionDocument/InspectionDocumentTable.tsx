import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuFileText,
  LuPencil,
  LuTarget,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { InspectionDocument } from "../../types";

type InspectionDocumentTableProps = {
  data: InspectionDocument[];
  count: number;
};

const defaultColumnVisibility = {
  createdAt: false,
  updatedAt: false,
  updatedBy: false
};

const InspectionDocumentTable = memo(
  ({ data, count }: InspectionDocumentTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const { t } = useLingui();
    const permissions = usePermissions();

    const deleteDisclosure = useDisclosure();
    const [selectedDiagram, setSelectedDiagram] =
      useState<InspectionDocument | null>(null);

    const columns = useMemo<ColumnDef<InspectionDocument>[]>(
      () => [
        {
          accessorKey: "name",
          header: t`Name`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.inspectionDocument(row.original.id)}>
              {row.original.name}
            </Hyperlink>
          ),
          meta: { icon: <LuTarget /> }
        },
        {
          id: "createdBy",
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: { icon: <LuFileText /> }
        },
        {
          id: "updatedBy",
          header: t`Updated By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.updatedBy} />
          ),
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "updatedAt",
          header: t`Updated At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: { icon: <LuFileText /> }
        }
      ],
      [t]
    );

    const renderContextMenu = useCallback(
      (row: InspectionDocument) => (
        <>
          <MenuItem
            disabled={!permissions.can("update", "quality")}
            onClick={() => {
              navigate(
                `${path.to.inspectionDocument(row.id)}?${params?.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Diagram
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "quality")}
            onClick={() => {
              flushSync(() => {
                setSelectedDiagram(row);
              });
              deleteDisclosure.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Diagram
          </MenuItem>
        </>
      ),
      [permissions, navigate, params, deleteDisclosure]
    );

    return (
      <>
        <Table<InspectionDocument>
          data={data}
          columns={columns}
          count={count}
          defaultColumnVisibility={defaultColumnVisibility}
          primaryAction={
            permissions.can("create", "quality") && (
              <New
                label={t`Inspection Document`}
                to={`${path.to.newInspectionDocument}?${params?.toString()}`}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Inspection Documents`}
        />
        {deleteDisclosure.isOpen && selectedDiagram && (
          <ConfirmDelete
            action={path.to.deleteInspectionDocument(selectedDiagram.id)}
            isOpen
            onCancel={() => {
              setSelectedDiagram(null);
              deleteDisclosure.onClose();
            }}
            onSubmit={() => {
              setSelectedDiagram(null);
              deleteDisclosure.onClose();
            }}
            name={selectedDiagram.name}
            text={t`Are you sure you want to delete this inspection document?`}
          />
        )}
      </>
    );
  }
);

InspectionDocumentTable.displayName = "InspectionDocumentTable";
export default InspectionDocumentTable;
