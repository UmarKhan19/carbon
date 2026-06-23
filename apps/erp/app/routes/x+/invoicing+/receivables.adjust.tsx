import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getDefaultAccounts,
  upsertJournalEntryLine
} from "~/modules/accounting";
import { getArTieOut } from "~/modules/invoicing";
import { path } from "~/utils/path";

// Turns a non-zero AR tie-out variance into a Draft journal entry pre-filled
// with the receivables control account and the variance amount, then drops the
// user on the journal-entry editor to pick the offset account and post. The
// variance is recomputed server-side (not trusted from the form) so the seeded
// line always matches the current books.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { create: "accounting" });

  const formData = await request.formData();
  const asOfDate =
    (formData.get("asOfDate") as string | null) ??
    new Date().toISOString().slice(0, 10);

  const [tieOut, defaults] = await Promise.all([
    getArTieOut(client, companyId, asOfDate),
    getDefaultAccounts(client, companyId)
  ]);

  const variance = Number(tieOut.data?.variance ?? 0);
  const accountId = defaults.data?.receivablesAccount;

  if (!accountId || variance === 0) {
    throw redirect(
      path.to.receivables,
      await flash(request, error(null, "No receivables variance to adjust"))
    );
  }

  const serviceRole = getCarbonServiceRole();
  const journalEntry = await serviceRole.functions.invoke<{ id: string }>(
    "create",
    {
      body: { type: "journalEntry", companyId, userId },
      region: FunctionRegion.UsEast1
    }
  );

  if (!journalEntry.data || journalEntry.error) {
    throw redirect(
      path.to.receivables,
      await flash(
        request,
        error(journalEntry.error, "Failed to create adjusting entry")
      )
    );
  }

  // Subledger > GL (variance > 0): raise the AR asset balance in the GL with a
  // debit; otherwise a credit.
  const line = await upsertJournalEntryLine(client, {
    journalId: String(journalEntry.data.id),
    accountId,
    description: `AR tie-out adjustment as of ${asOfDate}`,
    debit: variance > 0 ? variance : 0,
    credit: variance < 0 ? -variance : 0,
    companyId,
    companyGroupId
  });

  if (line.error) {
    // The Draft journal exists; send the user to it to finish by hand rather
    // than reporting a clean success.
    throw redirect(
      path.to.journalEntryDetails(String(journalEntry.data.id)),
      await flash(
        request,
        error(line.error, "Entry created, but seeding the line failed")
      )
    );
  }

  throw redirect(path.to.journalEntryDetails(String(journalEntry.data.id)));
}
