import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getAccountsList } from "~/modules/accounting";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const type = searchParams.get("type");
  const classes = searchParams.getAll("class");

  const incomeBalance = searchParams.get("incomeBalance");
  const result = await getAccountsList(client, companyGroupId, {
    type,
    incomeBalance,
    classes
  });

  return result;
}
