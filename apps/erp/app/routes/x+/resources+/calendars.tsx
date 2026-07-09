import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  getLocationsList,
  getResourceCalendars,
  ResourceCalendarsTable
} from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Calendars`,
  to: path.to.resourceCalendars
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [calendars, locations] = await Promise.all([
    getResourceCalendars(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getLocationsList(client, companyId)
  ]);

  if (calendars.error) {
    redirect(
      path.to.resources,
      await flash(request, error(calendars.error, "Failed to fetch calendars"))
    );
  }

  return {
    count: calendars.count ?? 0,
    calendars: calendars.data ?? [],
    locations: locations.data ?? []
  };
}

export default function ResourceCalendarsRoute() {
  const { count, calendars, locations } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ResourceCalendarsTable
        data={calendars}
        count={count}
        locations={locations}
      />
      <Outlet />
    </VStack>
  );
}
