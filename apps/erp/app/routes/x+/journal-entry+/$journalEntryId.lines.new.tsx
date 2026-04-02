import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import {
  journalEntryLineValidator,
  upsertJournalEntryLine
} from "~/modules/accounting";
import { JournalEntryLineForm } from "~/modules/accounting/ui/JournalEntries";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      create: "accounting"
    }
  );

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const formData = await request.formData();
  const validation = await validator(journalEntryLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await upsertJournalEntryLine(client, {
    ...validation.data,
    journalId: Number(journalEntryId),
    companyId,
    companyGroupId
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to add line"))
    );
  }

  throw redirect(
    path.to.journalEntryDetails(journalEntryId),
    await flash(request, success("Line added"))
  );
}

export default function NewJournalEntryLineRoute() {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const navigate = useNavigate();

  return (
    <JournalEntryLineForm
      initialValues={{
        journalEntryId,
        accountNumber: "",
        description: "",
        debit: 0,
        credit: 0
      }}
      onClose={() => navigate(path.to.journalEntryDetails(journalEntryId))}
    />
  );
}
