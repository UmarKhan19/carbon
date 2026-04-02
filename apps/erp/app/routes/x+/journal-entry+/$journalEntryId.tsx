import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { PanelProvider } from "~/components/Layout";
import { getJournalEntry } from "~/modules/accounting";
import { JournalEntryHeader } from "~/modules/accounting/ui/JournalEntries";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Journal Entries",
  to: path.to.accountingJournals
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const journalEntry = await getJournalEntry(client, journalEntryId);

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
    journalEntry: journalEntry.data
  };
}

export default function JournalEntryRoute() {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <JournalEntryHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-y-auto scrollbar-hide w-full">
          <VStack spacing={4} className="h-full p-2 w-full max-w-5xl mx-auto">
            <Outlet />
          </VStack>
        </div>
      </div>
    </PanelProvider>
  );
}
