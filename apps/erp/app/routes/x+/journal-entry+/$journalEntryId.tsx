import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { getCompaniesInGroup, getJournalEntry } from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Journal Entries",
  to: path.to.accountingJournals
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting"
    }
  );

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const [journalEntry, companies] = await Promise.all([
    getJournalEntry(client, journalEntryId),
    getCompaniesInGroup(client, companyGroupId)
  ]);

  if (journalEntry.error) {
    throw redirect(
      path.to.accountingJournals,
      await flash(
        request,
        error(journalEntry.error, "Failed to load journal entry")
      )
    );
  }

  if (journalEntry.data.companyId !== companyId) {
    throw redirect(path.to.accountingJournals);
  }

  return {
    journalEntry: journalEntry.data,
    companies: companies.data ?? []
  };
}

export default function JournalEntryRoute() {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  return (
    <div className="flex h-[calc(100dvh-49px)] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 w-full max-w-5xl mx-auto">
        <Outlet />
      </div>
    </div>
  );
}
