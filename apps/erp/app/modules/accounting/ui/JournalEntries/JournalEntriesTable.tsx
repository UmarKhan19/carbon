import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useMemo } from "react";
import {
  LuCalendar,
  LuCircleDollarSign,
  LuFileText,
  LuHash,
  LuStar,
  LuTag
} from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { path } from "~/utils/path";
import { journalEntryStatuses } from "../../accounting.models";
import type { JournalEntryListItem } from "../../types";
import JournalEntryStatus from "./JournalEntryStatus";

type JournalEntriesTableProps = {
  data: JournalEntryListItem[];
  count: number;
  primaryAction?: ReactNode;
};

const JournalEntriesTable = memo(
  ({ data, count, primaryAction }: JournalEntriesTableProps) => {
    const columns = useMemo<ColumnDef<JournalEntryListItem>[]>(() => {
      const defaultColumns: ColumnDef<JournalEntryListItem>[] = [
        {
          accessorKey: "journalEntryId",
          header: "ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.journalEntryDetails(row.original.id)}>
              {row.original.journalEntryId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "postingDate",
          header: "Date",
          cell: ({ row }) =>
            new Date(row.original.postingDate).toLocaleDateString(),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "description",
          header: "Description",
          cell: ({ row }) => (
            <div className="max-w-[300px] truncate">
              {row.original.description || "—"}
            </div>
          ),
          meta: {
            icon: <LuFileText />
          }
        },
        {
          accessorKey: "entryType",
          header: "Type",
          cell: ({ row }) => row.original.entryType || "—",
          meta: {
            icon: <LuTag />
          }
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: ({ row }) => (
            <JournalEntryStatus status={row.original.status} />
          ),
          meta: {
            filter: {
              type: "static",
              options: journalEntryStatuses.map((v) => ({
                label: v,
                value: v
              }))
            },
            icon: <LuStar />
          }
        },
        {
          accessorKey: "totalDebits",
          header: "Debits",
          cell: ({ row }) =>
            new Intl.NumberFormat("en-US", {
              style: "decimal",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            }).format(Number(row.original.totalDebits)),
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          accessorKey: "totalCredits",
          header: "Credits",
          cell: ({ row }) =>
            new Intl.NumberFormat("en-US", {
              style: "decimal",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            }).format(Number(row.original.totalCredits)),
          meta: {
            icon: <LuCircleDollarSign />
          }
        }
      ];
      return defaultColumns;
    }, []);

    return (
      <Table<JournalEntryListItem>
        data={data}
        columns={columns}
        count={count}
        primaryAction={primaryAction}
        title="Journal Entries"
      />
    );
  }
);

JournalEntriesTable.displayName = "JournalEntriesTable";
export default JournalEntriesTable;
