import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { JournalEntry } from "~/modules/accounting";
import {
  journalEntryValidator,
  updateJournalEntry
} from "~/modules/accounting";
import {
  JournalEntryForm,
  JournalEntryLines,
  JournalEntrySummary
} from "~/modules/accounting/ui/JournalEntries";
import { getCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const formData = await request.formData();
  const validation = await validator(journalEntryValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await updateJournalEntry(client, journalEntryId, {
    ...validation.data,
    updatedBy: userId
  });

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, "Failed to update journal entry")
      )
    );
  }

  throw redirect(
    path.to.journalEntryDetails(journalEntryId),
    await flash(request, success("Journal entry updated"))
  );
}

export default function JournalEntryDetailsRoute() {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const routeData = useRouteData<{
    journalEntry: JournalEntry;
  }>(path.to.journalEntry(journalEntryId));

  if (!routeData?.journalEntry)
    throw new Error("Could not find journal entry in routeData");

  const isPosted = routeData.journalEntry.status === "Posted";

  const initialValues = {
    id: routeData.journalEntry.id,
    postingDate: routeData.journalEntry.postingDate,
    description: routeData.journalEntry.description ?? "",
    entryType: routeData.journalEntry.entryType ?? undefined,
    ...getCustomFields(routeData.journalEntry.customFields)
  };

  return (
    <div className="flex flex-col gap-2 pb-16 w-full">
      <JournalEntryForm initialValues={initialValues} isDisabled={isPosted} />
      <JournalEntryLines />
      <JournalEntrySummary />
    </div>
  );
}
