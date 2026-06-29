import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getChangeOrderWorkflows } from "~/modules/items";
import { ChangeOrderWorkflowsTable } from "~/modules/items/ui/ChangeOrderWorkflow";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Workflows`,
  to: path.to.changeOrderWorkflows,
  module: "items"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const workflows = await getChangeOrderWorkflows(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  return {
    workflows: workflows.data ?? [],
    count: workflows.count ?? 0
  };
}

export default function ChangeOrderWorkflowsRoute() {
  const { workflows, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ChangeOrderWorkflowsTable data={workflows} count={count} />
      <Outlet />
    </VStack>
  );
}
