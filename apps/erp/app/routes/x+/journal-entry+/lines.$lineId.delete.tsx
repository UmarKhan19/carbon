import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { deleteJournalEntryLine } from "~/modules/accounting";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { lineId } = params;
  if (!lineId) throw new Error("Could not find lineId");

  const result = await deleteJournalEntryLine(client, lineId);

  return {
    success: !result.error,
    message: result.error?.message || "Line deleted"
  };
}
