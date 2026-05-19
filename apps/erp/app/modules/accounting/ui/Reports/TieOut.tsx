import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatePicker,
  Heading,
  HStack,
  Status,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import {
  LuCalendar,
  LuCircleDot,
  LuCoins,
  LuHash,
  LuUser
} from "react-icons/lu";
import { CustomerAvatar, SupplierAvatar, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter, useDateFormatter, useUrlParams } from "~/hooks";

type TieOutResult = {
  subledgerBalance: number;
  glBalance: number;
  variance: number;
};

type TieOutDrillRow = {
  invoiceId: string;
  invoiceNumber: string;
  dateDue: string | null;
  currencyCode: string;
  exchangeRate: number;
  totalAmount: number;
  settled: number;
  openInCurrency: number;
  openInBase: number;
  customerId?: string;
  supplierId?: string;
};

type TieOutProps = {
  side: "ar" | "ap";
  result: TieOutResult | null;
  rows: TieOutDrillRow[];
  asOfDate: string;
};

// Single tie-out view rendered by both ar-tie-out and ap-tie-out
// routes. The two route handlers diverge only in which RPC they call;
// the presentation is identical so a shared component is the right
// shape per the locked decision (two pages, shared component).
export function TieOut({ side, result, rows, asOfDate }: TieOutProps) {
  const { t } = useLingui();
  const [, setParams] = useUrlParams();
  const currencyFormatter = useCurrencyFormatter();
  const { formatDate } = useDateFormatter();

  const sideLabel =
    side === "ar" ? t`Accounts Receivable` : t`Accounts Payable`;
  const variance = result?.variance ?? 0;
  const reconciled = Math.abs(variance) < 0.01;

  const columns = useMemo<ColumnDef<TieOutDrillRow>[]>(
    () => [
      {
        accessorKey: "invoiceNumber",
        header: t`Invoice`,
        cell: ({ row }) => row.original.invoiceNumber,
        meta: { icon: <LuHash /> }
      },
      {
        id: "counterparty",
        header: side === "ar" ? t`Customer` : t`Supplier`,
        cell: ({ row }) =>
          row.original.customerId ? (
            <CustomerAvatar customerId={row.original.customerId} />
          ) : row.original.supplierId ? (
            <SupplierAvatar supplierId={row.original.supplierId} />
          ) : null,
        meta: { icon: <LuUser /> }
      },
      {
        accessorKey: "dateDue",
        header: t`Due`,
        cell: ({ row }) =>
          row.original.dateDue ? formatDate(row.original.dateDue) : "—",
        meta: { icon: <LuCalendar /> }
      },
      {
        accessorKey: "currencyCode",
        header: t`Currency`,
        cell: ({ row }) => <Enumerable value={row.original.currencyCode} />,
        meta: { icon: <LuCircleDot /> }
      },
      {
        accessorKey: "totalAmount",
        header: t`Total`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {Number(row.original.totalAmount).toFixed(2)}
          </span>
        ),
        meta: { icon: <LuCoins /> }
      },
      {
        accessorKey: "settled",
        header: t`Settled`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {Number(row.original.settled).toFixed(2)}
          </span>
        )
      },
      {
        accessorKey: "openInCurrency",
        header: t`Open (Local)`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {Number(row.original.openInCurrency).toFixed(2)}
          </span>
        )
      },
      {
        accessorKey: "openInBase",
        header: t`Open (Base)`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {currencyFormatter.format(Number(row.original.openInBase))}
          </span>
        ),
        meta: {
          renderTotal: true,
          formatter: currencyFormatter.format
        }
      }
    ],
    [t, side, formatDate, currencyFormatter]
  );

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex px-4 py-3 items-center justify-between bg-card border-b border-border w-full">
        <Heading size="h3">
          {sideLabel} <Trans>Tie-Out</Trans>
        </Heading>
        <HStack>
          <span className="text-sm text-muted-foreground">
            <Trans>As of:</Trans>
          </span>
          <DatePicker
            value={parseDate(asOfDate)}
            onChange={(value) =>
              setParams({ asOfDate: value?.toString() ?? asOfDate })
            }
          />
        </HStack>
      </div>

      <div className="grid grid-cols-3 gap-4 w-full p-6">
        <SummaryCard
          title={t`Subledger`}
          value={currencyFormatter.format(result?.subledgerBalance ?? 0)}
        />
        <SummaryCard
          title={t`GL Control Account`}
          value={currencyFormatter.format(result?.glBalance ?? 0)}
        />
        <SummaryCard
          title={t`Variance`}
          value={currencyFormatter.format(variance)}
          badge={
            reconciled ? (
              <Status color="green">
                <Trans>Reconciled</Trans>
              </Status>
            ) : (
              <Status color="red">
                <Trans>Break</Trans>
              </Status>
            )
          }
        />
      </div>

      <div className="flex-1 w-full">
        <Table<TieOutDrillRow>
          data={rows}
          columns={columns}
          count={rows.length}
          title={t`Open Invoices`}
        />
      </div>
    </VStack>
  );
}

function SummaryCard({
  title,
  value,
  badge
}: {
  title: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between">
          <CardDescription>{title}</CardDescription>
          {badge}
        </HStack>
        <CardTitle className="tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
