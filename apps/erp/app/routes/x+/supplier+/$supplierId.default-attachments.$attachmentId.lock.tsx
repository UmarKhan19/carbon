import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { setAttachmentLock } from "~/modules/purchasing";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { attachmentId } = params;
  if (!attachmentId) throw new Error("Missing attachmentId");

  const formData = await request.formData();
  const isLocked = formData.get("locked") === "true";

  const result = await setAttachmentLock(client, {
    table: "supplierDefaultAttachment",
    id: attachmentId,
    isLocked
  });

  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(result.error, "Failed to update lock"))
    );
  }
  return data(
    { success: true },
    await flash(
      request,
      success(isLocked ? "Attachment locked" : "Attachment unlocked")
    )
  );
}
