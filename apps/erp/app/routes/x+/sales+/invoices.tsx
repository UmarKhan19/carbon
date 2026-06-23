import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Outlet, useLoaderData } from "react-router";
import SalesInvoicesTable from "~/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable";
import type { loader } from "~/routes/x+/invoicing+/sales";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

// Single source of truth lives in the invoicing module route to avoid drift;
// this Sales-module route is the same list under the Sales sidebar.
export { loader } from "~/routes/x+/invoicing+/sales";

export const handle: Handle = {
  breadcrumb: msg`Invoices`,
  to: path.to.salesInvoices
};

export default function SalesInvoicesSearchRoute() {
  const { count, salesInvoices } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesInvoicesTable data={salesInvoices} count={count} />
      <Outlet />
    </VStack>
  );
}
