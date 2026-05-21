import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteCompanyDefaultAttachment } from "~/modules/purchasing";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "settings"
  });

  const { attachmentId } = params;
  if (!attachmentId) throw new Error("Missing attachmentId");

  const result = await deleteCompanyDefaultAttachment(client, attachmentId);
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to delete attachment"))
    );
  }
  return data(
    { success: true },
    await flash(request, success("Default attachment removed"))
  );
}
