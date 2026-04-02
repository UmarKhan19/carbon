import { Card, CardContent } from "@carbon/react";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { JournalEntry } from "../../types";

const JournalEntrySummary = () => {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("journalEntryId not found");

  const routeData = useRouteData<{
    journalEntry: JournalEntry;
  }>(path.to.journalEntry(journalEntryId));

  if (!routeData?.journalEntry) return null;

  const lines = routeData.journalEntry.journalLine ?? [];
  const totalDebits = lines.reduce(
    (sum, l) => sum + Math.max(Number(l.amount), 0),
    0
  );
  const totalCredits = lines.reduce(
    (sum, l) => sum + Math.max(-Number(l.amount), 0),
    0
  );
  const difference = totalDebits - totalCredits;
  const isBalanced = lines.length > 0 && Math.abs(difference) < 0.001;

  const format = (n: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center justify-end gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Total Debits:</span>
            <span className="font-mono font-medium tabular-nums">
              {format(totalDebits)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Total Credits:</span>
            <span className="font-mono font-medium tabular-nums">
              {format(totalCredits)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Difference:</span>
            <span
              className={`font-mono font-semibold tabular-nums ${
                isBalanced
                  ? "text-green-600 dark:text-green-400"
                  : "text-destructive"
              }`}
            >
              {format(Math.abs(difference))}
              {isBalanced && lines.length > 0 && " ✓"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default JournalEntrySummary;
