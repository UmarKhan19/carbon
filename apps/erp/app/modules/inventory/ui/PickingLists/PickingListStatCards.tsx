import { Card, CardContent, cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { PickingListLine } from "../../types";

type Props = {
  lines: PickingListLine[];
  dueDate: string | null;
};

// Three KPI cards mirroring the mockup: lines picked, units progress, due
// date (highlighted red when overdue). Numbers are computed client-side
// from the lines array so the parent loader doesn't need a special query.
export default function PickingListStatCards({ lines, dueDate }: Props) {
  const totalLines = lines.length;
  const linesPicked = lines.filter(
    (l) => Number(l.pickedQuantity ?? 0) > 0
  ).length;

  const totals = lines.reduce(
    (acc, l) => {
      const required = Number(l.adjustedQuantity ?? l.estimatedQuantity ?? 0);
      const picked = Number(l.pickedQuantity ?? 0);
      acc.required += required;
      acc.picked += Math.min(picked, required || picked);
      return acc;
    },
    { required: 0, picked: 0 }
  );

  const linePct = totalLines > 0 ? linesPicked / totalLines : 0;
  const unitPct = totals.required > 0 ? totals.picked / totals.required : 0;
  const unitPctLabel = Math.round(unitPct * 100);

  const due = dueDate ? new Date(dueDate) : null;
  const overdue = due != null && due < new Date();
  const dueLabel = due
    ? due.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      })
    : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
      <StatCard
        label={<Trans>Lines Picked</Trans>}
        primary={
          <span className="tabular-nums">
            <span className="text-foreground">{linesPicked}</span>
            <span className="text-muted-foreground"> of {totalLines}</span>
          </span>
        }
      >
        <div className="h-1.5 mt-3 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${linePct * 100}%` }}
          />
        </div>
      </StatCard>

      <StatCard
        label={<Trans>Units</Trans>}
        primary={
          <span className="tabular-nums">
            <span className="text-foreground">{totals.picked}</span>
            <span className="text-muted-foreground"> of {totals.required}</span>
          </span>
        }
      >
        <div className="text-xs text-muted-foreground mt-2">
          {unitPctLabel}% <Trans>complete</Trans>
        </div>
      </StatCard>

      <StatCard
        label={<Trans>Due</Trans>}
        primary={
          dueLabel ? (
            <span
              className={cn(
                "tabular-nums",
                overdue ? "text-red-500" : "text-foreground"
              )}
            >
              {dueLabel}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        }
      />
    </div>
  );
}

function StatCard({
  label,
  primary,
  children
}: {
  label: React.ReactNode;
  primary: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="text-xxs uppercase tracking-wide text-muted-foreground/70 font-medium">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold leading-tight">
          {primary}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
