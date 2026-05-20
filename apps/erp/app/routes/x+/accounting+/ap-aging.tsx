import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AgingReport } from "~/modules/accounting/ui/Reports";
import { getApAging } from "~/modules/invoicing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "AP Aging",
  to: path.to.apAging,
  module: "accounting"
};

function parseBuckets(raw: string | null): [number, number, number] {
  const parts = (raw ?? "").split(",").map((n) => Number.parseInt(n, 10));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return [parts[0], parts[1], parts[2]];
  }
  return [30, 60, 90];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const url = new URL(request.url);
  const asOfDate =
    url.searchParams.get("asOfDate") ?? new Date().toISOString().slice(0, 10);
  const agingMethod: "dueDate" | "documentDate" =
    url.searchParams.get("agingMethod") === "documentDate"
      ? "documentDate"
      : "dueDate";
  const bucketDays = parseBuckets(url.searchParams.get("bucketDays"));

  const aging = await getApAging(client, companyId, asOfDate, {
    agingMethod,
    bucketDays
  });

  return {
    asOfDate,
    agingMethod,
    bucketDays,
    rows: aging.data ?? []
  };
}

export default function ApAgingRoute() {
  const { asOfDate, agingMethod, bucketDays, rows } =
    useLoaderData<typeof loader>();
  return (
    <AgingReport
      side="ap"
      rows={rows}
      asOfDate={asOfDate}
      agingMethod={agingMethod}
      bucketDays={bucketDays}
    />
  );
}
