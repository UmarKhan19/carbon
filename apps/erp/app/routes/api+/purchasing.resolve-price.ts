import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { resolvePrice } from "~/modules/pricing";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const body = await request.json();

  const result = await resolvePrice(client, companyId, {
    ...body,
    listType: "Purchase"
  });

  return data(result);
}
