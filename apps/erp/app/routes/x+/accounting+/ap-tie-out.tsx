import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { TieOut } from "~/modules/accounting/ui/Reports";
import { getApOpenBySupplier, getApTieOut } from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "AP Tie-Out",
  to: path.to.apTieOut,
  module: "accounting"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const url = new URL(request.url);
  const asOfDate =
    url.searchParams.get("asOfDate") ?? new Date().toISOString().slice(0, 10);

  const [tieOut, rows] = await Promise.all([
    getApTieOut(client, companyId, asOfDate),
    getApOpenBySupplier(client, companyId, asOfDate)
  ]);

  return {
    asOfDate,
    result: tieOut.data ?? null,
    rows: rows.data ?? []
  };
}

export default function ApTieOutRoute() {
  const { asOfDate, result, rows } = useLoaderData<typeof loader>();
  return <TieOut side="ap" result={result} rows={rows} asOfDate={asOfDate} />;
}
