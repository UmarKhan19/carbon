import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deletePickingList } from "~/modules/inventory";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "inventory"
  });

  const { pickingListId } = params;
  if (!pickingListId) throw new Response("Not found", { status: 404 });

  const result = await deletePickingList(client, pickingListId);

  if (result.error) {
    throw redirect(
      path.to.pickingListDetails(pickingListId),
      await flash(request, error(result.error, "Failed to delete picking list"))
    );
  }

  throw redirect(
    path.to.pickingLists,
    await flash(request, success("Picking list deleted successfully"))
  );
}
