import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { clearConsolePinIn } from "~/services/console.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {});

  throw redirect(path.to.authenticatedRoot, {
    headers: {
      "Set-Cookie": clearConsolePinIn(companyId)
    }
  });
}
