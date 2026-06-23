import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Outlet, useLoaderData } from "react-router";
import { PurchaseInvoicesTable } from "~/modules/invoicing";
import type { loader } from "~/routes/x+/invoicing+/purchasing";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

// Single source of truth lives in the invoicing module route to avoid drift;
// this Purchasing-module route is the same list under the Purchasing sidebar.
export { loader } from "~/routes/x+/invoicing+/purchasing";

export const handle: Handle = {
  breadcrumb: msg`Invoices`,
  to: path.to.purchaseInvoices
};

export default function PurchaseInvoicesSearchRoute() {
  const { count, purchaseInvoices } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PurchaseInvoicesTable data={purchaseInvoices} count={count} />
      <Outlet />
    </VStack>
  );
}
