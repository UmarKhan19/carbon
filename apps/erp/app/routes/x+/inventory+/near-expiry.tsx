import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getNearExpiryTrackedEntities } from "~/modules/inventory";
import TrackedEntitiesTable from "~/modules/inventory/ui/Traceability/TrackedEntitiesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Near-Expiry Inventory",
  to: path.to.nearExpiryInventory
};

// Default threshold: show entities expiring within the next 30 days
const NEAR_EXPIRY_THRESHOLD_DAYS = 30;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const url = new URL(request.url);
  const thresholdParam = url.searchParams.get("days");
  const thresholdDays = thresholdParam
    ? Math.max(
        1,
        Math.min(365, Number(thresholdParam) || NEAR_EXPIRY_THRESHOLD_DAYS)
      )
    : NEAR_EXPIRY_THRESHOLD_DAYS;

  const nearExpiry = await getNearExpiryTrackedEntities(
    client,
    companyId,
    thresholdDays
  );

  if (nearExpiry.error) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(null, "Error loading near-expiry inventory"))
    );
  }

  return {
    trackedEntities: nearExpiry.data ?? [],
    count: nearExpiry.count ?? 0,
    thresholdDays
  };
}

export default function NearExpiryInventoryRoute() {
  const { trackedEntities, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TrackedEntitiesTable data={trackedEntities ?? []} count={count ?? 0} />
    </VStack>
  );
}
