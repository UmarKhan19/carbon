import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { priceResolutionInputValidator, resolvePrice } from "~/modules/sales";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const payload = priceResolutionInputValidator.safeParse(await request.json());

  if (!payload.success) {
    return data(
      { errors: payload.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const result = await resolvePrice(client, companyId, payload.data);

  return data(result);
}
