import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DatePicker,
  Heading,
  HStack,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { LuUser } from "react-icons/lu";
import { CustomerAvatar, SupplierAvatar, Table } from "~/components";
import { useCurrencyFormatter, useUrlParams } from "~/hooks";

type AgingRow = {
  customerId?: string;
  supplierId?: string;
  current: number;
  bucket1: number;
  bucket2: number;
  bucket3: number;
  bucket4: number;
  unapplied: number;
  total: number;
};

type AgingReportProps = {
  side: "ar" | "ap";
  rows: AgingRow[];
  asOfDate: string;
  agingMethod: "dueDate" | "documentDate";
  bucketDays: [number, number, number];
};

// Shared aging view rendered by both ar-aging and ap-aging routes.
// Buckets and the age basis (due vs document date) are driven by URL
// params so the labels and the data stay in sync.
export function AgingReport({
  side,
  rows,
  asOfDate,
  agingMethod,
  bucketDays
}: AgingReportProps) {
  const { t } = useLingui();
  const [, setParams] = useUrlParams();
  const currencyFormatter = useCurrencyFormatter();
  const [b1, b2, b3] = bucketDays;

  const sideLabel =
    side === "ar" ? t`Accounts Receivable` : t`Accounts Payable`;

  const money = (n: number) => currencyFormatter.format(Number(n));

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          current: acc.current + Number(r.current),
          bucket1: acc.bucket1 + Number(r.bucket1),
          bucket2: acc.bucket2 + Number(r.bucket2),
          bucket3: acc.bucket3 + Number(r.bucket3),
          bucket4: acc.bucket4 + Number(r.bucket4),
          unapplied: acc.unapplied + Number(r.unapplied),
          total: acc.total + Number(r.total)
        }),
        {
          current: 0,
          bucket1: 0,
          bucket2: 0,
          bucket3: 0,
          bucket4: 0,
          unapplied: 0,
          total: 0
        }
      ),
    [rows]
  );

  const columns = useMemo<ColumnDef<AgingRow>[]>(
    () => [
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
        accessorKey: "current",
        header: t`Current`,
        cell: ({ row }) => (
          <span className="tabular-nums">{money(row.original.current)}</span>
        ),
        meta: { renderTotal: true, formatter: currencyFormatter.format }
      },
      {
        accessorKey: "bucket1",
        header: `1-${b1}`,
        cell: ({ row }) => (
          <span className="tabular-nums">{money(row.original.bucket1)}</span>
        ),
        meta: { renderTotal: true, formatter: currencyFormatter.format }
      },
      {
        accessorKey: "bucket2",
        header: `${b1 + 1}-${b2}`,
        cell: ({ row }) => (
          <span className="tabular-nums">{money(row.original.bucket2)}</span>
        ),
        meta: { renderTotal: true, formatter: currencyFormatter.format }
      },
      {
        accessorKey: "bucket3",
        header: `${b2 + 1}-${b3}`,
        cell: ({ row }) => (
          <span className="tabular-nums">{money(row.original.bucket3)}</span>
        ),
        meta: { renderTotal: true, formatter: currencyFormatter.format }
      },
      {
        accessorKey: "bucket4",
        header: `${b3}+`,
        cell: ({ row }) => (
          <span className="tabular-nums">{money(row.original.bucket4)}</span>
        ),
        meta: { renderTotal: true, formatter: currencyFormatter.format }
      },
      {
        accessorKey: "unapplied",
        header: t`Unapplied`,
        cell: ({ row }) => (
          <span className="tabular-nums">{money(row.original.unapplied)}</span>
        ),
        meta: { renderTotal: true, formatter: currencyFormatter.format }
      },
      {
        accessorKey: "total",
        header: t`Total`,
        cell: ({ row }) => (
          <span className="tabular-nums font-semibold">
            {money(row.original.total)}
          </span>
        ),
        meta: { renderTotal: true, formatter: currencyFormatter.format }
      }
    ],
    [t, side, b1, b2, b3, currencyFormatter]
  );

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex px-4 py-3 items-center justify-between bg-card border-b border-border w-full">
        <Heading size="h3">
          {sideLabel} <Trans>Aging</Trans>
        </Heading>
        <HStack>
          <Select
            value={agingMethod}
            onValueChange={(value) => setParams({ agingMethod: value })}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dueDate">
                <Trans>By Due Date</Trans>
              </SelectItem>
              <SelectItem value="documentDate">
                <Trans>By Document Date</Trans>
              </SelectItem>
            </SelectContent>
          </Select>
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

      <div className="grid grid-cols-4 gap-4 w-full p-6">
        <SummaryCard title={t`Current`} value={money(totals.current)} />
        <SummaryCard title={`${b2 + 1}-${b3}`} value={money(totals.bucket3)} />
        <SummaryCard title={`${b3}+`} value={money(totals.bucket4)} />
        <SummaryCard title={t`Total Outstanding`} value={money(totals.total)} />
      </div>

      <div className="flex-1 w-full">
        <Table<AgingRow>
          data={rows}
          columns={columns}
          count={rows.length}
          title={t`Aging by Counterparty`}
        />
      </div>
    </VStack>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
