import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  pickingListStatusType,
  updatePickingListStatus
} from "~/modules/inventory";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { pickingListId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof pickingListStatusType)[number];

  if (!status || !pickingListStatusType.includes(status)) {
    throw redirect(
      path.to.pickingList(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const update = await updatePickingListStatus(client, id, status, userId);

  if (update.error) {
    throw redirect(
      path.to.pickingList(id),
      await flash(
        request,
        error(update.error, "Failed to update picking list status")
      )
    );
  }

  throw redirect(
    path.to.pickingList(id),
    await flash(request, success("Updated picking list status"))
  );
}
