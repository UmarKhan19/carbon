import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  IconButton
} from "@carbon/react";
import { LuPlus, LuTrash } from "react-icons/lu";
import { useFetcher, useNavigate, useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { JournalEntry, JournalEntryLine } from "../../types";

const JournalEntryLines = () => {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("journalEntryId not found");

  const routeData = useRouteData<{
    journalEntry: JournalEntry;
  }>(path.to.journalEntry(journalEntryId));

  const permissions = usePermissions();
  const navigate = useNavigate();

  if (!routeData?.journalEntry) return null;

  const lines = routeData.journalEntry.journalLine ?? [];
  const isDraft = routeData.journalEntry.status === "Draft";
  const canEdit = isDraft && permissions.can("update", "accounting");

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between w-full">
          <CardTitle>Lines</CardTitle>
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuPlus />}
              onClick={() =>
                navigate(path.to.newJournalEntryLine(journalEntryId))
              }
            >
              Add Line
            </Button>
          )}
        </HStack>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4 text-center">
            No lines yet. Click "Add Line" to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 px-3 font-medium">Account</th>
                  <th className="py-2 px-3 font-medium">Description</th>
                  <th className="py-2 px-3 font-medium text-right">Debit</th>
                  <th className="py-2 px-3 font-medium text-right">Credit</th>
                  {canEdit && <th className="py-2 px-3 font-medium w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <JournalEntryLineRow
                    key={line.id}
                    line={line}
                    canEdit={canEdit}
                    journalEntryId={journalEntryId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

function JournalEntryLineRow({
  line,
  canEdit,
  journalEntryId
}: {
  line: JournalEntryLine;
  canEdit: boolean;
  journalEntryId: string;
}) {
  const navigate = useNavigate();
  const deleteFetcher = useFetcher();

  const formatAmount = (amount: number) =>
    amount > 0
      ? new Intl.NumberFormat("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(amount)
      : "—";

  return (
    <tr
      className="border-b hover:bg-muted/50 cursor-pointer"
      onClick={() => {
        if (canEdit) {
          navigate(`${path.to.journalEntry(journalEntryId)}/lines/${line.id}`);
        }
      }}
    >
      <td className="py-2 px-3 font-mono text-xs">{line.accountNumber}</td>
      <td className="py-2 px-3">{line.description || "—"}</td>
      <td className="py-2 px-3 text-right tabular-nums">
        {formatAmount(Math.max(Number(line.amount), 0))}
      </td>
      <td className="py-2 px-3 text-right tabular-nums">
        {formatAmount(Math.max(-Number(line.amount), 0))}
      </td>
      {canEdit && (
        <td className="py-2 px-3">
          <deleteFetcher.Form
            method="post"
            action={path.to.deleteJournalEntryLine(line.id)}
            onClick={(e) => e.stopPropagation()}
          >
            <IconButton
              type="submit"
              aria-label="Delete line"
              icon={<LuTrash />}
              variant="ghost"
              size="sm"
              className="text-destructive"
            />
          </deleteFetcher.Form>
        </td>
      )}
    </tr>
  );
}

export default JournalEntryLines;
