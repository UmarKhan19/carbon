import { Heading, HStack, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";

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
  const fetcher = useFetcher();
  const [date, setDate] = useState(asOfDate);
  const sideLabel = side === "ar" ? "Accounts Receivable" : "Accounts Payable";
  const variance = result?.variance ?? 0;
  const reconciled = Math.abs(variance) < 0.01;

  return (
    <VStack spacing={4} className="p-6 max-w-6xl">
      <HStack className="justify-between w-full">
        <Heading size="h2">
          {sideLabel} <Trans>Tie-Out</Trans>
        </Heading>
        <fetcher.Form method="get" className="flex items-center gap-2">
          <label className="text-sm">
            <Trans>As of:</Trans>
            <input
              type="date"
              name="asOfDate"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="ml-2 border border-border rounded px-2 py-1 text-sm"
            />
          </label>
          <button
            type="submit"
            className="bg-primary text-primary-foreground rounded px-3 py-1.5 text-sm hover:opacity-90"
          >
            <Trans>Refresh</Trans>
          </button>
        </fetcher.Form>
      </HStack>

      <div className="grid grid-cols-3 gap-4 w-full">
        <SummaryCard label="Subledger" value={result?.subledgerBalance ?? 0} />
        <SummaryCard
          label="GL Control Account"
          value={result?.glBalance ?? 0}
        />
        <SummaryCard
          label="Variance"
          value={variance}
          status={reconciled ? "ok" : "break"}
        />
      </div>

      <Heading size="h3">
        <Trans>Open Invoices</Trans>{" "}
        <span className="text-muted-foreground text-base">({rows.length})</span>
      </Heading>
      <div className="w-full rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Invoice</th>
              <th className="text-left p-3">
                {side === "ar" ? "Customer" : "Supplier"}
              </th>
              <th className="text-left p-3">Due</th>
              <th className="text-left p-3">Currency</th>
              <th className="text-right p-3">Total</th>
              <th className="text-right p-3">Settled</th>
              <th className="text-right p-3">Open (Local)</th>
              <th className="text-right p-3">Open (Base)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="p-6 text-center text-muted-foreground"
                >
                  <Trans>No open invoices as of this date.</Trans>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.invoiceId} className="border-t border-border">
                  <td className="p-3">{r.invoiceNumber}</td>
                  <td className="p-3">{r.customerId ?? r.supplierId ?? "—"}</td>
                  <td className="p-3">{r.dateDue ?? "—"}</td>
                  <td className="p-3">{r.currencyCode}</td>
                  <td className="p-3 text-right tabular-nums">
                    {Number(r.totalAmount).toFixed(2)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {Number(r.settled).toFixed(2)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {Number(r.openInCurrency).toFixed(2)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {Number(r.openInBase).toFixed(2)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </VStack>
  );
}

function SummaryCard({
  label,
  value,
  status
}: {
  label: string;
  value: number;
  status?: "ok" | "break";
}) {
  const color =
    status === "ok"
      ? "text-green-600"
      : status === "break"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>
        {value.toFixed(2)}
      </div>
      {status === "ok" && (
        <div className="text-xs text-green-600 mt-1">
          <Trans>Subledger matches GL.</Trans>
        </div>
      )}
      {status === "break" && (
        <div className="text-xs text-destructive mt-1">
          <Trans>Subledger and GL do not match.</Trans>
        </div>
      )}
    </div>
  );
}
