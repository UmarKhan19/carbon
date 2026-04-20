import { Badge } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuClipboardCheck,
  LuPackage,
  LuSquareStack,
  LuTruck,
  LuUser
} from "react-icons/lu";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { useUrlParams } from "~/hooks";
import { inboundInspectionStatus } from "~/modules/quality/quality.models";
import type { InboundInspection } from "~/modules/quality/types";
import { path } from "~/utils/path";

type InboundInspectionsTableProps = {
  data: InboundInspection[];
  count: number;
};

const defaultColumnVisibility = {
  inspectedAt: false,
  inspectedBy: false,
  createdAt: true
};

function getStatusVariant(status: string) {
  if (status === "Passed") return "green";
  if (status === "Failed") return "red";
  return "secondary";
}

const InboundInspectionsTable = memo(
  ({ data, count }: InboundInspectionsTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();

    const columns = useMemo<ColumnDef<InboundInspection>[]>(() => {
      return [
        {
          accessorKey: "itemReadableId",
          header: t`Item`,
          cell: ({ row }) => (
            <Hyperlink
              to={`${path.to.inboundInspection(row.original.id!)}?${params.toString()}`}
            >
              <div className="flex flex-col gap-0">
                <span className="text-sm font-medium">
                  {row.original.itemReadableId ??
                    // @ts-ignore - relation
                    row.original.item?.readableId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {
                    // @ts-ignore - relation
                    row.original.item?.name
                  }
                </span>
              </div>
            </Hyperlink>
          ),
          meta: { icon: <LuBookMarked /> }
        },
        {
          id: "serialOrBatch",
          header: t`Serial / Batch`,
          cell: ({ row }) => {
            // @ts-ignore - attributes
            const value = row.original.trackedEntity?.readableId ?? "";
            return <span className="text-sm">{value}</span>;
          },
          meta: { icon: <LuSquareStack /> }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <Badge variant={getStatusVariant(row.original.status)}>
              {row.original.status}
            </Badge>
          ),
          meta: {
            icon: <LuClipboardCheck />,
            filter: {
              type: "static",
              options: inboundInspectionStatus.map((s) => ({
                value: s,
                label: <Badge variant={getStatusVariant(s)}>{s}</Badge>
              }))
            }
          }
        },
        {
          id: "receipt",
          header: t`Receipt`,
          cell: ({ row }) => (
            <span className="text-sm">
              {
                // @ts-ignore - relation
                row.original.receipt?.receiptId
              }
            </span>
          ),
          meta: { icon: <LuTruck /> }
        },
        {
          accessorKey: "createdBy",
          header: t`Received By`,
          cell: ({ row }) => (
            <EmployeeAvatar employeeId={row.original.createdBy} />
          ),
          meta: { icon: <LuPackage /> }
        },
        {
          accessorKey: "createdAt",
          header: t`Received At`,
          cell: ({ row }) =>
            row.original.createdAt ? formatDate(row.original.createdAt) : "",
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "inspectedBy",
          header: t`Inspected By`,
          cell: ({ row }) =>
            row.original.inspectedBy ? (
              <EmployeeAvatar employeeId={row.original.inspectedBy} />
            ) : null,
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "inspectedAt",
          header: t`Inspected At`,
          cell: ({ row }) =>
            row.original.inspectedAt
              ? formatDate(row.original.inspectedAt)
              : "",
          meta: { icon: <LuCalendar /> }
        }
      ];
    }, [t, params]);

    return (
      <Table<InboundInspection>
        data={data}
        columns={columns}
        count={count ?? 0}
        defaultColumnVisibility={defaultColumnVisibility}
        title={t`Inbound Inspections`}
        table="inboundInspection"
        withSavedView
      />
    );
  }
);

InboundInspectionsTable.displayName = "InboundInspectionsTable";
export default InboundInspectionsTable;
