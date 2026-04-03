import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { ShelfLifeTypesTable } from "~/modules/inventory";
import { getShelfLifeLabelTypes, getStorageTypes } from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Shelf Life Types",
  to: path.to.storageTypes
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const [storageTypes, labelTypes] = await Promise.all([
    getStorageTypes(client, companyId),
    getShelfLifeLabelTypes(client, companyId)
  ]);

  return {
    storageTypes: storageTypes.data ?? [],
    labelTypes: labelTypes.data ?? []
  };
}

export default function ShelfLifeTypesRoute() {
  const { storageTypes, labelTypes } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ShelfLifeTypesTable
        storageTypes={storageTypes}
        labelTypes={labelTypes}
      />
      <Outlet />
    </VStack>
  );
}
