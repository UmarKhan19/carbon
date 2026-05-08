import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { PanelProvider } from "~/components/Layout";
import { ResizablePanels } from "~/components/Layout/Panels";
import {
  getPickingList,
  getPickingListLines,
  PickingListExplorer,
  PickingListHeader,
  PickingListLines,
  PickingListProperties
} from "~/modules/inventory";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Picking Lists`,
  to: path.to.pickingLists
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const serviceRole = await getCarbonServiceRole();

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [pickingList, pickingListLines] = await Promise.all([
    getPickingList(serviceRole, id),
    getPickingListLines(serviceRole, id, companyId)
  ]);

  if (pickingList.error) {
    throw redirect(
      path.to.pickingLists,
      await flash(
        request,
        error(pickingList.error, "Failed to load picking list")
      )
    );
  }

  if (pickingList.data.companyId !== companyId) {
    throw redirect(path.to.pickingLists);
  }

  if (pickingListLines.error) {
    throw redirect(
      path.to.pickingLists,
      await flash(
        request,
        error(pickingListLines.error, "Failed to load picking list lines")
      )
    );
  }

  // Pull active impacting incidents for this PL's job so the lines
  // component can label any adjustedQuantity strikethrough with the
  // incident that caused it.
  const incidentRows = await serviceRole
    .from("productionIncident")
    .select(
      `id, incidentId, itemId, trackedEntityId, quantityLost, incidentDate,
       incidentType:incidentTypeId(name)`
    )
    .eq("jobId", pickingList.data.jobId)
    .eq("companyId", companyId)
    .eq("impactsPickingList", true);

  return {
    pickingList: pickingList.data,
    pickingListLines: pickingListLines.data ?? [],
    incidents: incidentRows.data ?? []
  };
}

export default function PickingListRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <PickingListHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <ResizablePanels
            explorer={<PickingListExplorer />}
            content={
              <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                <VStack spacing={4} className="p-4">
                  <PickingListLines />
                </VStack>
              </div>
            }
            properties={<PickingListProperties key={id} />}
          />
        </div>
      </div>
      <Outlet />
    </PanelProvider>
  );
}
