import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect } from "react-router";
import {
  getSupplier,
  getSupplierApprovalContext,
  getSupplierContacts,
  getSupplierLocations
} from "~/modules/purchasing";
import SupplierHeader from "~/modules/purchasing/ui/Supplier/SupplierHeader";
import SupplierSidebar from "~/modules/purchasing/ui/Supplier/SupplierSidebar";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Suppliers`,
  to: path.to.suppliers
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const [supplier, contacts, locations, tags] = await Promise.all([
    getSupplier(client, supplierId),
    getSupplierContacts(client, supplierId),
    getSupplierLocations(client, supplierId),
    getTagsList(client, companyId, "supplier")
  ]);

  if (supplier.error) {
    throw redirect(
      path.to.suppliers,
      await flash(
        request,
        error(supplier.error, "Failed to load supplier summary")
      )
    );
  }

  const serviceRole = getCarbonServiceRole();
  const status = supplier.data?.status ?? null;
  const approval = await getSupplierApprovalContext(
    serviceRole,
    supplierId,
    status,
    companyId,
    userId
  );

  return {
    supplier: supplier.data,
    contacts: contacts.data ?? [],
    locations: locations.data ?? [],
    tags: tags.data ?? [],
    ...approval
  };
}

export default function SupplierRoute() {
  return (
    <>
      <SupplierHeader />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <SupplierSidebar />
        <Outlet />
      </div>
    </>
  );
}
