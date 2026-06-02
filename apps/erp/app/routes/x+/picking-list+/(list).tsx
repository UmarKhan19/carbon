import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getPickingLists, getPickingSchedule } from "~/modules/inventory";
import {
  PickingListsTable,
  PickingSchedule
} from "~/modules/inventory/ui/PickingLists";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Picking Lists`,
  to: path.to.pickingLists
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const assignee = searchParams.get("assignee");
  const locationId = searchParams.get("locationId") ?? "";
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [pickingLists, pickingSchedule] = await Promise.all([
    getPickingLists(client, companyId, {
      search,
      status,
      assignee,
      locationId: searchParams.get("locationId"),
      limit,
      offset,
      sorts,
      filters
    }),
    locationId
      ? getPickingSchedule(client, {
          locationId,
          companyId
        })
      : Promise.resolve({ data: [], error: null })
  ]);

  if (pickingLists.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(null, "Error loading picking lists"))
    );
  }

  return {
    pickingLists: pickingLists.data ?? [],
    pickingListCount: pickingLists.count ?? 0,
    pickingSchedule: pickingSchedule.data ?? [],
    locationId
  };
}

export default function PickingListsRoute() {
  const { pickingLists, pickingListCount, pickingSchedule, locationId } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <Tabs defaultValue="schedule" className="w-full h-full">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="lists">Lists</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule" className="h-full">
          <PickingSchedule data={pickingSchedule} locationId={locationId} />
        </TabsContent>
        <TabsContent value="lists" className="h-full">
          <PickingListsTable data={pickingLists} count={pickingListCount} />
        </TabsContent>
      </Tabs>
      <Outlet />
    </VStack>
  );
}
