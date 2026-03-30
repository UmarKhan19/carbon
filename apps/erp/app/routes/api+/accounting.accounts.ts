import { requirePermissions } from "@carbon/auth/auth.server";
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
    // @ts-expect-error TS2322 - TODO: fix type
    type,
    // @ts-expect-error TS2322 - TODO: fix type
    incomeBalance,
    // @ts-expect-error TS2322 - TODO: fix type
    classes
  });

  return result;
}
