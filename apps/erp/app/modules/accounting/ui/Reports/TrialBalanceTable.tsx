import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuHash, LuText } from "react-icons/lu";
import { Table } from "~/components";

type TrialBalanceRow = {
  accountId: string;
  accountNumber: string | null;
  accountName: string | null;
  accountClass: string | null;
  incomeBalance: string | null;
  debitBalance: number;
  creditBalance: number;
  netChange: number;
};

type TrialBalanceTableProps = {
  data: TrialBalanceRow[];
  count: number;
};

function formatCurrency(value: number): string {
  if (value === 0) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const TrialBalanceTable = memo(({ data, count }: TrialBalanceTableProps) => {
  const columns = useMemo<ColumnDef<TrialBalanceRow>[]>(
    () => [
      {
        accessorKey: "accountNumber",
        header: "Account",
        cell: ({ row }) => (
          <span className="font-mono text-muted-foreground">
            {row.original.accountNumber}
          </span>
        ),
        size: 100,
        meta: {
          icon: <LuHash />
        }
      },
      {
        accessorKey: "accountName",
        header: "Name",
        cell: ({ row }) => row.original.accountName,
        meta: {
          icon: <LuText />
        }
      },
      {
        accessorKey: "debitBalance",
        header: "Debit",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCurrency(row.original.debitBalance)}
          </span>
        ),
        size: 150,
        meta: {
          renderTotal: true,
          formatter: (val) => formatCurrency(Number(val))
        }
      },
      {
        accessorKey: "creditBalance",
        header: "Credit",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCurrency(row.original.creditBalance)}
          </span>
        ),
        size: 150,
        meta: {
          renderTotal: true,
          formatter: (val) => formatCurrency(Number(val))
        }
      },
      {
        accessorKey: "netChange",
        header: "Net Change",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCurrency(row.original.netChange)}
          </span>
        ),
        size: 150,
        meta: {
          renderTotal: true,
          formatter: (val) => formatCurrency(Number(val))
        }
      }
    ],
    []
  );

  return (
    <Table<TrialBalanceRow>
      data={data}
      columns={columns}
      count={count}
      withSimpleSorting={false}
      title="Trial Balance"
    />
  );
});

TrialBalanceTable.displayName = "TrialBalanceTable";
export default TrialBalanceTable;
