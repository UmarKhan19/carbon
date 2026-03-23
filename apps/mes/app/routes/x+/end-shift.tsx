import { requirePermissions } from "@carbon/auth/auth.server";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  clearConsolePinIn,
  getConsoleMode
} from "~/services/console.server";
import { getEffectiveUserId } from "~/services/effective-user.server";
import { endProductionEvents } from "~/services/operations.service";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId: sessionUserId } = await requirePermissions(request, {});
  const userId = getEffectiveUserId(request, { companyId, sessionUserId });
  const formData = await request.formData();
  const timezone = formData.get("timezone") as string | null;

  const updates = await endProductionEvents(client, {
    companyId,
    employeeId: userId,
    endTime: now(timezone ?? getLocalTimeZone()).toAbsoluteString()
  });

  if (updates.error) {
    return data(
      { success: false, message: updates.error.message },
      { status: 500 }
    );
  }

  // In console mode, pin out the operator after ending their shift
  const headers = new Headers();
  if (getConsoleMode(request, companyId)) {
    headers.append("Set-Cookie", clearConsolePinIn(companyId));
  }

  return data(
    { success: true, message: "Successfully ended shift" },
    headers.has("Set-Cookie") ? { headers } : undefined
  );
}
