import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getAccountCategoriesList } from "~/modules/accounting";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {});

  return await getAccountCategoriesList(client, companyGroupId);
}
