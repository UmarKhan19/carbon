import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const redirectTo = formData.get("redirectTo") as string | null;

  // Keep ITAR handling unchanged — compliance blocker
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

  // Generic flag handling — covers training dismissals and any future flags
  if (intent === "flag") {
    const flag = formData.get("flag") as string;
    const value = formData.get("value") !== "false";

    if (!flag) {
      return { success: false, message: "Missing flag key" };
    }

    const { data: user } = await client
      .from("user")
      .select("flags")
      .eq("id", userId)
      .single();

    const currentFlags = (user?.flags as Record<string, boolean>) ?? {};
    const updatedFlags = { ...currentFlags, [flag]: value };

    const updateResult = await client
      .from("user")
      .update({ flags: updatedFlags })
      .eq("id", userId);

    if (updateResult.error) {
      return { success: false, message: "Failed to update flag" };
    }

    if (redirectTo) {
      throw redirect(redirectTo);
    }

    return { success: true, message: "Flag updated" };
  }
}
