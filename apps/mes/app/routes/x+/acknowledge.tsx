import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const redirectTo = formData.get("redirectTo") as string | null;

  if (intent === "academy") {
    const { data: user, error: readError } = await client
      .from("user")
      .select("flags")
      .eq("id", userId)
      .single();

    if (readError) {
      return { success: false, message: "Failed to read user flags" };
    }

    const currentFlags = (user?.flags as Record<string, boolean> | null) ?? {};
    const updatedFlags = { ...currentFlags, academy: true };

    await client.from("user").update({ flags: updatedFlags }).eq("id", userId);

    if (redirectTo) {
      throw redirect(redirectTo);
    }

    return { success: true, message: "University acknowledged" };
  }

  if (intent === "itar") {
    const updateResult = await client
      .from("user")
      .update({
        acknowledgedITAR: true
      })
      .eq("id", userId);

    if (updateResult.error) {
      return {
        success: false,
        message: "Failed to update ITAR acknowledgement"
      };
    }

    return { success: true, message: "ITAR acknowledged" };
  }
}
