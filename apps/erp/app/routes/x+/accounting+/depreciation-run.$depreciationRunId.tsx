import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  redirect,
  useFetcher,
  useLoaderData,
  useParams
} from "react-router";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  getDepreciationRun,
  getDepreciationRunLines
} from "~/modules/accounting";
import { DepreciationRunStatus } from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Depreciation Run",
  to: path.to.depreciationRuns
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { depreciationRunId } = params;
  if (!depreciationRunId) throw new Error("Could not find depreciationRunId");

  const [run, lines] = await Promise.all([
    getDepreciationRun(client, depreciationRunId),
    getDepreciationRunLines(client, depreciationRunId)
  ]);

  if (run.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(run.error, "Failed to load depreciation run"))
    );
  }

  return {
    run: run.data,
    lines: lines.data ?? []
  };
}

export default function DepreciationRunDetailRoute() {
  const { depreciationRunId } = useParams();
  const { run, lines } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  if (!depreciationRunId) throw new Error("Could not find depreciationRunId");

  const isDraft = run.status === "Draft";
  const totalAmount = lines.reduce((sum, line) => sum + Number(line.amount), 0);

  return (
    <div className="flex h-[calc(100dvh-49px)] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 w-full max-w-5xl mx-auto">
        <VStack spacing={4}>
          <HStack className="justify-between w-full">
            <HStack spacing={4}>
              <div>
                <h1 className="text-2xl font-bold">{run.depreciationRunId}</h1>
                <p className="text-sm text-muted-foreground">
                  Period End: {formatDate(run.periodEnd)}
                </p>
              </div>
              <DepreciationRunStatus status={run.status} />
            </HStack>
            {isDraft && permissions.can("update", "accounting") && (
              <fetcher.Form method="post" action="post">
                <Button
                  variant="primary"
                  type="submit"
                  isLoading={fetcher.state !== "idle"}
                >
                  Post Run
                </Button>
              </fetcher.Form>
            )}
          </HStack>

          <Card className="w-full">
            <CardHeader>
              <CardTitle>
                Depreciation Lines ({lines.length} assets, total:{" "}
                {currencyFormatter.format(totalAmount)})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No assets to depreciate for this period.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2">Asset ID</th>
                      <th className="text-left py-2">Name</th>
                      <th className="text-right py-2">Acquisition Cost</th>
                      <th className="text-right py-2">Accum. Depreciation</th>
                      <th className="text-right py-2">Depreciation Amount</th>
                      <th className="text-right py-2">NBV After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => {
                      const asset = line.fixedAsset as any;
                      const cost = Number(asset?.acquisitionCost ?? 0);
                      const accDepr = Number(
                        asset?.accumulatedDepreciation ?? 0
                      );
                      const nbvAfter = cost - accDepr - Number(line.amount);
                      return (
                        <tr key={line.id} className="border-b">
                          <td className="py-2">{asset?.fixedAssetId ?? "—"}</td>
                          <td className="py-2">{asset?.name ?? "—"}</td>
                          <td className="py-2 text-right">
                            {currencyFormatter.format(cost)}
                          </td>
                          <td className="py-2 text-right">
                            {currencyFormatter.format(accDepr)}
                          </td>
                          <td className="py-2 text-right font-medium">
                            {currencyFormatter.format(Number(line.amount))}
                          </td>
                          <td className="py-2 text-right">
                            {currencyFormatter.format(nbvAfter)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </VStack>
        <Outlet />
      </div>
    </div>
  );
}
