import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getIssues, getIssueTypesList } from "~/modules/quality";
import IssuesTable from "~/modules/quality/ui/Issue/IssuesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Issues",
  to: path.to.issues
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [issues, nonConformanceTypes] = await Promise.all([
    getIssues(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getIssueTypesList(client, companyId)
  ]);

  if (issues.error) {
    console.error(issues.error);
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(issues.error, "Error loading issues"))
    );
  }

  // Fetch containment action tasks to determine containment status per issue
  const issueIds = (issues.data ?? []).map((i) => i.id);
  const { data: containmentTasks } =
    issueIds.length > 0
      ? await client
          .from("nonConformanceActionTask")
          .select(
            "nonConformanceId, status, nonConformanceRequiredAction!inner(name)"
          )
          .eq("companyId", companyId)
          .eq("nonConformanceRequiredAction.name", "Containment Action")
          .in("nonConformanceId", issueIds)
      : { data: [] };

  const containmentStatuses: Record<string, string> = {};
  for (const task of containmentTasks ?? []) {
    if (task.status === "In Progress" || task.status === "Completed") {
      containmentStatuses[task.nonConformanceId] = "Contained";
    }
  }
  for (const issue of issues.data ?? []) {
    if (!containmentStatuses[issue.id]) {
      containmentStatuses[issue.id] = "Uncontained";
    }
  }

  return {
    issues: issues.data ?? [],
    count: issues.count ?? 0,
    types: nonConformanceTypes.data ?? [],
    containmentStatuses
  };
}

export default function IssuesRoute() {
  const { issues, count, types, containmentStatuses } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <IssuesTable
        data={issues}
        count={count}
        types={types}
        containmentStatuses={containmentStatuses}
      />
      <Outlet />
    </VStack>
  );
}
