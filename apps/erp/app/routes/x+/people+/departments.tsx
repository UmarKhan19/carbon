import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getDepartments } from "~/modules/people";
import { DepartmentsTable } from "~/modules/people/ui/Departments";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Departments`,
  to: path.to.departments
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const departments = await getDepartments(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (departments.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(departments.error, "Failed to load departments")
      )
    );
  }

  return {
    departments: departments.data ?? [],
    count: departments.count ?? 0
  };
}

export default function Route() {
  const { departments, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <DepartmentsTable data={departments} count={count} />
      <Outlet />
    </VStack>
  );
}
