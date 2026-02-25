import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { LoaderFunctionArgs } from "react-router";
import { getAccountsList } from "~/modules/accounting";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const type = searchParams.get("type");
  const classes = searchParams.getAll("class");

  const incomeBalance = searchParams.get("incomeBalance");
  const result = await getAccountsList(client, companyId, {
    type: type as Database["public"]["Enums"]["glAccountType"] | null,
    incomeBalance: incomeBalance as
      | Database["public"]["Enums"]["glIncomeBalance"]
      | null,
    classes: classes as Database["public"]["Enums"]["glAccountClass"][]
  });

  return result;
}
