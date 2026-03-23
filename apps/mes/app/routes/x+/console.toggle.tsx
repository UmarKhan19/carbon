import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { clearConsolePinIn, setConsoleMode } from "~/services/console.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const enabled = formData.get("consoleMode") === "true";

  const headers = new Headers();
  headers.append("Set-Cookie", setConsoleMode(companyId, enabled));

  // When disabling console mode, also clear any active pin-in
  if (!enabled) {
    headers.append("Set-Cookie", clearConsolePinIn(companyId));
  }

  return redirect(path.to.authenticatedRoot, { headers });
}
