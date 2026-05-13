import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, VStack } from "@carbon/react";
import { LuCirclePlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigate } from "react-router";
import { usePermissions } from "~/hooks";
import { getDepreciationRuns } from "~/modules/accounting";
import { DepreciationRunTable } from "~/modules/accounting/ui/FixedAssets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Depreciation Runs",
  to: path.to.depreciationRuns
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const runs = await getDepreciationRuns(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  return {
    data: runs.data ?? [],
    count: runs.count ?? 0
  };
}

export default function DepreciationRunsRoute() {
  const { data, count } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <VStack spacing={0} className="h-full">
      <DepreciationRunTable
        data={data}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") && (
            <Button
              leftIcon={<LuCirclePlus />}
              variant="primary"
              onClick={() => navigate(path.to.newDepreciationRun)}
            >
              New Depreciation Run
            </Button>
          )
        }
      />
      <Outlet />
    </VStack>
  );
}
