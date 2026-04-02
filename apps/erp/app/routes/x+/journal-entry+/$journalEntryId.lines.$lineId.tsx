import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { JournalEntry } from "~/modules/accounting";
import {
  journalEntryLineValidator,
  upsertJournalEntryLine
} from "~/modules/accounting";
import { JournalEntryLineForm } from "~/modules/accounting/ui/JournalEntries";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { journalEntryId, lineId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const validation = await validator(journalEntryLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await upsertJournalEntryLine(client, {
    ...validation.data,
    id: lineId,
    updatedBy: userId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to update line"))
    );
  }

  throw redirect(
    path.to.journalEntryDetails(journalEntryId),
    await flash(request, success("Line updated"))
  );
}

export default function EditJournalEntryLineRoute() {
  const { journalEntryId, lineId } = useParams();
  if (!journalEntryId) throw new Error("Could not find journalEntryId");
  if (!lineId) throw new Error("Could not find lineId");

  const navigate = useNavigate();
  const routeData = useRouteData<{
    journalEntry: JournalEntry;
  }>(path.to.journalEntry(journalEntryId));

  const line = routeData?.journalEntry?.journalLine?.find(
    (l) => l.id === lineId
  );

  if (!line) throw new Error("Could not find line");

  const amount = Number(line.amount);

  return (
    <JournalEntryLineForm
      initialValues={{
        id: line.id,
        journalEntryId,
        accountNumber: line.accountNumber,
        description: line.description ?? "",
        debit: Math.max(amount, 0),
        credit: Math.max(-amount, 0)
      }}
      onClose={() => navigate(path.to.journalEntryDetails(journalEntryId))}
    />
  );
}
